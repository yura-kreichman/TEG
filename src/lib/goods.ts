import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InsufficientBalanceError, notifyWalletBalanceChange } from "@/lib/abonement";
import { PAYMENT_SPLIT_METHOD, type PaymentLegInput, validateSplitLegs } from "@/lib/payment-split";

type Tx = Prisma.TransactionClient;

// Модуль "Товары" (docs/spec/09-goods.md) — продажа сопутствующих товаров и
// товаров-услуг на точках. Не POS: продажа фиксирует priceSnapshot (паттерн
// Launch.priceSnapshot) и способ оплаты, остаток — мягкий счётчик без
// блокировки при нуле. Касса "Товары" — переиспользование существующего
// MoneyOperation.pointId-слота (тот же приём, что у abonement_topup,
// src/lib/abonement.ts), НЕ новый CHECK-констрейнт.

export const GOODS_PAYMENT_METHODS = ["cash", "mobile", "abonement"] as const;
export type GoodsPaymentMethod = (typeof GOODS_PAYMENT_METHODS)[number];

type Actor = { operatorId: string; userId?: undefined } | { userId: string; operatorId?: undefined };

function moneyTypeFor(paymentMethod: GoodsPaymentMethod): string {
  if (paymentMethod === "cash") return "goods_revenue";
  if (paymentMethod === "mobile") return "goods_revenue_cashless";
  return "goods_revenue_abonement";
}

interface SellParams {
  tenantId: string;
  pointId: string;
  goodsId: string;
  quantity: number;
  paymentMethod: GoodsPaymentMethod;
  walletId?: string; // только paymentMethod="abonement"
  legs?: PaymentLegInput[];
  actor: Actor;
}

/**
 * Продажа ОДНОЙ позиции внутри уже открытой транзакции — общее ядро для
 * sellGoods (одна позиция, своя транзакция) и sellGoodsCart (несколько
 * позиций, ОДНА транзакция на всю корзину — запрос пользователя 2026-07-21:
 * "такой же принцип корзины должен быть в Товарах"). Снапшот цены, декремент
 * остатка (только trackStock), MoneyOperation (нал/безнал) ИЛИ
 * AbonementTransaction+MoneyOperation (баланс, тот же паттерн, что
 * spendWalletTx в abonement.ts — условный UPDATE WHERE balance >= amount, 0
 * обновлённых строк = недостаточно средств, без гонки между операторами).
 * Мягкий остаток — decrement всегда проходит, даже уводя в минус
 * (docs/spec/09-goods.md, "Остатки": "блокировки при нуле НЕТ").
 */
async function sellOneItemTx(
  tx: Tx,
  params: {
    tenantId: string;
    pointId: string;
    goodsId: string;
    quantity: number;
    // Разбивка оплаты (запрос пользователя 2026-07-26) — необязательная;
    // при split=true запись создаётся с paymentMethod=PAYMENT_SPLIT_METHOD и
    // без walletId — фактическое списание/журналирование делает
    // settleSaleLegsTx ниже, отдельным шагом (для корзины суммы долей нужно
    // сначала распределить по позициям — см. sellGoodsCart).
    paymentMethod: GoodsPaymentMethod | typeof PAYMENT_SPLIT_METHOD;
    walletId?: string;
    actor: Actor;
    // Предзагруженный товар (аудит 2026-07-27, N+1) — sellGoodsCart выбирает
    // ВСЕ товары корзины ОДНИМ findMany до цикла, вместо отдельного
    // tx.goods.findFirst на каждую позицию. sellGoods (одиночная продажа)
    // не передаёт — там всё равно только один товар, кэшировать нечего.
    preloadedGoods?: { id: string; price: Prisma.Decimal; trackStock: boolean };
  }
) {
  const { tenantId, pointId, goodsId, quantity, paymentMethod, walletId, actor, preloadedGoods } = params;

  // active:true — тот же принцип, что уже применён к goodsAllowBalancePayment
  // (docs/spec/09-goods.md: серверная проверка, не только скрытие в UI):
  // /api/operator/goods (GET, каталог) уже скрывает приостановленные товары
  // от Сотрудника, но продажа конкретного goodsId это не проверяла (аудит
  // 2026-07-24) — товар, поставленный владельцем на паузу (физически кончился),
  // всё ещё можно было продать, если запрос уже был в полёте или отправлен
  // напрямую. GOODS_NOT_FOUND — та же реакция, что и для реально
  // несуществующего/удалённого товара, с точки зрения продажи разницы нет.
  const goods =
    preloadedGoods ?? (await tx.goods.findFirst({ where: { id: goodsId, tenantId, deletedAt: null, active: true } }));
  if (!goods) throw new Error("GOODS_NOT_FOUND");

  const amount = Number(goods.price) * quantity;

  if (goods.trackStock) {
    // Тот же advisory-лок, что и у ревизии (reviseGoodsStockInTx выше) —
    // сам upsert-decrement здесь уже атомарен против ДРУГИХ продаж, но без
    // общего лока ревизия (читает остаток, потом АБСОЛЮТНО его перезаписывает
    // отдельным upsert) могла прочитать остаток ДО этого decrement и затем
    // закоммитить свою запись ПОСЛЕ — молча стерев декремент этой продажи
    // (аудит 2026-07-26). Один и тот же ключ лока у обеих операций сериализует
    // их друг против друга.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${goodsId}:${pointId}`}))`;
    await tx.goodsStock.upsert({
      where: { goodsId_pointId: { goodsId, pointId } },
      create: { goodsId, pointId, quantity: -quantity },
      update: { quantity: { decrement: quantity } },
    });
  }

  const sale = await tx.goodsSale.create({
    data: {
      tenantId,
      goodsId,
      pointId,
      quantity,
      priceSnapshot: goods.price,
      amount,
      paymentMethod,
      walletId: paymentMethod === "abonement" ? walletId : null,
      performedByOperatorId: actor.operatorId,
      performedByUserId: actor.userId,
    },
  });

  return { sale, amount };
}

/**
 * Фактическое списание/журналирование оплаты одной уже созданной продажи —
 * вынесено из sellOneItemTx (запрос пользователя 2026-07-26, разбивка
 * оплаты), потому что для корзины сумму каждой доли сначала нужно
 * распределить по позициям (см. sellGoodsCart), а сама продажа уже должна
 * существовать (доля привязана к saleId). Для одиночной продажи (sellGoods)
 * вызывается сразу с готовыми долями — распределять нечего, товар один.
 */
async function settleSaleLegsTx(
  tx: Tx,
  params: {
    tenantId: string;
    pointId: string;
    saleId: string;
    amount: number;
    paymentMethod: GoodsPaymentMethod | typeof PAYMENT_SPLIT_METHOD;
    walletId?: string;
    legs?: PaymentLegInput[];
    actor: Actor;
  }
) {
  const { tenantId, pointId, saleId, amount, paymentMethod, walletId, legs, actor } = params;

  // legs !== undefined, а не legs.length > 0 (аудит 2026-07-26) — при
  // разбивке корзины позиция с нулевым amount (промо-товар) может законно
  // получить ПУСТОЙ массив долей от allocateLegsAcrossItems; branch по
  // length ошибочно уводил такую позицию в ветку "else" ниже, которая
  // использует paymentMethod — placeholder-заглушку ("cash"), которую
  // caller подставляет только ради типов при разбивке, а не то, что реально
  // выбрал оператор — часть выручки молча приписывалась в наличные.
  if (legs !== undefined) {
    // Разбивка — каждая доля списывается/журналируется отдельно, тем же
    // кодом, что и обычная одиночная оплата ниже, просто в цикле по долям.
    for (const leg of legs) {
      if (leg.method === "abonement") {
        const updated = await tx.abonementWallet.updateMany({
          where: { id: leg.walletId, tenantId, balance: { gte: leg.amount } },
          data: { balance: { decrement: leg.amount } },
        });
        if (updated.count === 0) throw new InsufficientBalanceError();

        await tx.abonementTransaction.create({
          data: { walletId: leg.walletId!, type: "spend", amount: leg.amount, goodsSaleId: saleId, pointId, ...actor },
        });
      }

      await tx.moneyOperation.create({
        data: {
          tenantId,
          pointId,
          type: moneyTypeFor(leg.method as GoodsPaymentMethod),
          amount: leg.amount,
          performedByOperatorId: actor.operatorId,
          performedByUserId: actor.userId,
        },
      });
    }

    if (legs.length === 0) return;
    await tx.goodsSalePaymentLeg.createMany({
      data: legs.map((leg, index) => ({
        saleId,
        method: leg.method,
        amount: leg.amount,
        walletId: leg.walletId,
        order: index,
      })),
    });
  } else {
    if (paymentMethod === "abonement") {
      const updated = await tx.abonementWallet.updateMany({
        where: { id: walletId, tenantId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (updated.count === 0) throw new InsufficientBalanceError();

      await tx.abonementTransaction.create({
        data: { walletId: walletId!, type: "spend", amount, goodsSaleId: saleId, pointId, ...actor },
      });
    }

    await tx.moneyOperation.create({
      data: {
        tenantId,
        pointId,
        type: moneyTypeFor(paymentMethod as GoodsPaymentMethod),
        amount,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });
  }
}

/**
 * Распределяет доли разбивки (посчитанные на сумму ВСЕЙ корзины) по
 * отдельным позициям пропорционально их сумме — каждая позиция остаётся
 * собственной GoodsSale со своим amount, поэтому и её доли должны в сумме
 * давать ровно её amount (иначе аннулирование одной позиции не сможет
 * корректно вернуть именно её часть баланса/кассы). Копеечный остаток
 * округления — на последнюю долю последней позиции, чтобы сумма по каждому
 * методу в точности совпадала с введённой владельцем/оператором.
 */
function allocateLegsAcrossItems(
  legs: PaymentLegInput[],
  itemAmounts: number[]
): PaymentLegInput[][] {
  const total = itemAmounts.reduce((s, a) => s + a, 0);
  const perItem: PaymentLegInput[][] = itemAmounts.map(() => []);
  // Остаток округления — на последнюю долю КАЖДОЙ позиции, не только
  // последней позиции последней доли (реальный баг, найден аудитом
  // 2026-07-26: при 3+ позициях и 2+ долях старая версия копила погрешность
  // по всем позициям кроме последней, из-за чего сумма долей могла не
  // совпасть с итогом на копейку, а деньги "перетекали" между позициями —
  // ломая точный возврат доли при аннулировании ОДНОЙ позиции, ради чего эта
  // функция и написана, см. докстринг). Гарантия теперь: сумма долей КАЖДОЙ
  // позиции ТОЧНО равна её amount — остаток гасится внутри самой позиции.
  itemAmounts.forEach((itemAmount, itemIndex) => {
    let allocated = 0;
    legs.forEach((leg, legIndex) => {
      const isLastLeg = legIndex === legs.length - 1;
      const share = isLastLeg
        ? Math.round((itemAmount - allocated) * 100) / 100
        : Math.round(((leg.amount * itemAmount) / total) * 100) / 100;
      allocated += share;
      if (share > 0) {
        perItem[itemIndex]!.push({ method: leg.method, amount: share, walletId: leg.walletId });
      }
    });
  });
  return perItem;
}

export async function sellGoods(params: SellParams) {
  const { tenantId, pointId, goodsId, quantity, paymentMethod, walletId, legs, actor } = params;
  if (!legs || legs.length === 0) {
    if (paymentMethod === "abonement" && !walletId) throw new Error("WALLET_REQUIRED");
  }

  const { sale, amount } = await prisma.$transaction(async (tx) => {
    const created = await sellOneItemTx(tx, {
      tenantId,
      pointId,
      goodsId,
      quantity,
      paymentMethod: legs && legs.length > 0 ? PAYMENT_SPLIT_METHOD : paymentMethod,
      walletId,
      actor,
    });
    // Валидация суммы долей — ВНУТРИ транзакции, против created.amount (уже
    // прочитанного через tx), а не отдельным prisma.goods.findUniqueOrThrow
    // ДО открытия транзакции (аудит 2026-07-26: узкое окно, где владелец мог
    // успеть поменять цену товара между этими двумя независимыми чтениями —
    // доли были бы провалидированы против устаревшей цены, и сумма
    // GoodsSalePaymentLeg разошлась бы с GoodsSale.amount). Тот же паттерн,
    // что уже был правильно применён в sellGoodsCart.
    if (legs && legs.length > 0) {
      validateSplitLegs(legs, created.amount, GOODS_PAYMENT_METHODS);
    }
    await settleSaleLegsTx(tx, {
      tenantId,
      pointId,
      saleId: created.sale.id,
      amount: created.amount,
      paymentMethod,
      walletId,
      legs,
      actor,
    });
    return created;
  });

  const abonementLeg = legs?.find((l) => l.method === "abonement");
  if (abonementLeg) {
    await notifyWalletBalanceChange(tenantId, abonementLeg.walletId!, -abonementLeg.amount).catch(() => {});
  } else if (paymentMethod === "abonement" && walletId) {
    await notifyWalletBalanceChange(tenantId, walletId, -amount).catch(() => {});
  }
  return sale;
}

interface SellCartParams {
  tenantId: string;
  pointId: string;
  items: { goodsId: string; quantity: number }[];
  paymentMethod: GoodsPaymentMethod;
  walletId?: string; // только paymentMethod="abonement"
  legs?: PaymentLegInput[];
  actor: Actor;
}

export interface SoldCartLine {
  id: string;
  goodsId: string;
  quantity: number;
  amount: number;
}

/**
 * Продажа КОРЗИНЫ — несколько разных товаров одним чеком, одним способом
 * оплаты (запрос пользователя 2026-07-21: "сейчас можно продавать только по
 * одному товару"). Каждая позиция по-прежнему собственная запись GoodsSale
 * (история/отчёты не меняются, видят то же самое, что и раньше — просто N
 * продаж вместо одной), но ОДНОЙ атомарной транзакцией: либо весь чек
 * проходит, либо ни одна позиция (важно для баланса — недостаток средств на
 * третьей позиции откатывает уже decrement-нутые остатки первых двух). В
 * отличие от Билетов, здесь НЕТ отдельной сущности "заказ" — товары не
 * гасятся/не предъявляются повторно, поэтому обёртка не нужна вовсе.
 */
export async function sellGoodsCart(params: SellCartParams): Promise<SoldCartLine[]> {
  const { tenantId, pointId, items, paymentMethod, walletId, legs, actor } = params;
  const splitting = Boolean(legs && legs.length > 0);
  if (!splitting && paymentMethod === "abonement" && !walletId) throw new Error("WALLET_REQUIRED");
  if (items.length === 0) throw new Error("EMPTY_CART");

  const results = await prisma.$transaction(async (tx) => {
    // Все товары корзины — ОДНИМ findMany, не по одному на позицию в цикле
    // ниже (аудит 2026-07-27, N+1 в денежно-критичном пути). Те же фильтры,
    // что у sellOneItemTx по умолчанию — если товара тут нет (пауза/удалён),
    // preloadedGoods останется undefined, и sellOneItemTx сама сходит за ним
    // (найдёт то же самое "не найдено" и бросит GOODS_NOT_FOUND) — поведение
    // не меняется, батч только ускоряет обычный путь.
    const goodsRows = await tx.goods.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.goodsId))] }, tenantId, deletedAt: null, active: true },
    });
    const goodsById = new Map(goodsRows.map((g) => [g.id, g]));

    // Сначала создаём все позиции (без оплаты) — сумма корзины известна
    // только после этого, а разбивку по долям (запрос пользователя
    // 2026-07-26) нужно распределить пропорционально каждой позиции ДО
    // фактического списания, см. allocateLegsAcrossItems.
    const created: { sale: { id: string }; goodsId: string; quantity: number; amount: number }[] = [];
    for (const item of items) {
      const { sale, amount } = await sellOneItemTx(tx, {
        tenantId,
        pointId,
        goodsId: item.goodsId,
        quantity: item.quantity,
        paymentMethod: splitting ? PAYMENT_SPLIT_METHOD : paymentMethod,
        walletId,
        actor,
        preloadedGoods: goodsById.get(item.goodsId),
      });
      created.push({ sale, goodsId: item.goodsId, quantity: item.quantity, amount });
    }

    if (splitting) {
      validateSplitLegs(
        legs!,
        created.reduce((s, c) => s + c.amount, 0),
        GOODS_PAYMENT_METHODS
      );
      const perItemLegs = allocateLegsAcrossItems(
        legs!,
        created.map((c) => c.amount)
      );
      for (let i = 0; i < created.length; i++) {
        await settleSaleLegsTx(tx, {
          tenantId,
          pointId,
          saleId: created[i]!.sale.id,
          amount: created[i]!.amount,
          paymentMethod,
          walletId,
          legs: perItemLegs[i],
          actor,
        });
      }
    } else {
      for (const c of created) {
        await settleSaleLegsTx(tx, {
          tenantId,
          pointId,
          saleId: c.sale.id,
          amount: c.amount,
          paymentMethod,
          walletId,
          actor,
        });
      }
    }

    return created.map((c) => ({ id: c.sale.id, goodsId: c.goodsId, quantity: c.quantity, amount: c.amount }));
  });

  // Одно сообщение на всю корзину, не по позиции — способ оплаты общий на
  // чек (SellCartParams.paymentMethod), N уведомлений подряд были бы шумом.
  if (splitting) {
    const abonementLeg = legs!.find((l) => l.method === "abonement");
    if (abonementLeg) {
      await notifyWalletBalanceChange(tenantId, abonementLeg.walletId!, -abonementLeg.amount).catch(() => {});
    }
  } else if (paymentMethod === "abonement" && walletId) {
    const total = results.reduce((sum, r) => sum + r.amount, 0);
    await notifyWalletBalanceChange(tenantId, walletId, -total).catch(() => {});
  }
  return results;
}

interface RestockParams {
  tenantId: string;
  goodsId: string;
  pointId: string;
  quantity: number;
  userId: string;
}

/** Пополнение остатка — только владелец (docs/spec/09-goods.md, "Остатки"), без закупочных цен. */
export async function restockGoods(params: RestockParams) {
  const { tenantId, goodsId, pointId, quantity, userId } = params;

  return prisma.$transaction(async (tx) => {
    const goods = await tx.goods.findFirst({ where: { id: goodsId, tenantId, deletedAt: null } });
    if (!goods) throw new Error("GOODS_NOT_FOUND");
    if (!goods.trackStock) throw new Error("STOCK_NOT_TRACKED");

    // Тот же лок, что у продажи/ревизии выше (аудит 2026-07-26) — без него
    // довоз, попавший между чтением и абсолютной перезаписью остатка в
    // ревизии, точно так же молча терялся бы.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${goodsId}:${pointId}`}))`;
    await tx.goodsStock.upsert({
      where: { goodsId_pointId: { goodsId, pointId } },
      create: { goodsId, pointId, quantity },
      update: { quantity: { increment: quantity } },
    });

    return tx.goodsRestock.create({
      data: { goodsId, pointId, quantity, performedByUserId: userId },
    });
  });
}

/**
 * Аннулирование — только владелец (docs/spec/09-goods.md, "Аннулирование").
 * Возвращает остаток (если trackStock), сторнирует списание с баланса (если
 * paymentMethod="abonement" — новая AbonementTransaction type="refund",
 * баланс кошелька восстанавливается) и пишет компенсирующую MoneyOperation
 * (тот же тип, отрицательная сумма) — не удаляет исходную, тот же принцип,
 * что у остальных денежных корректировок в проекте. Запись в CorrectionLog
 * обязательна (entityType="GoodsSale").
 */
export async function voidGoodsSale(saleId: string, tenantId: string, userId: string, reason: string | null) {
  const { updated, refundedLegs } = await prisma.$transaction(async (tx) => {
    const sale = await tx.goodsSale.findFirst({ where: { id: saleId, tenantId } });
    if (!sale) throw new Error("SALE_NOT_FOUND");

    // CAS вместо отдельного if(sale.voidedAt) + безусловного update ниже
    // (аудит 2026-07-25: goodsSale.update без условия по voidedAt позволял
    // двум почти одновременным запросам на аннулирование одной продажи
    // обоим пройти ранний read-check — WHERE у update был только по id, а
    // второй запрос, дождавшись коммита первого на блокировке строки, всё
    // равно проходил дальше и повторно восстанавливал остаток/баланс).
    // updateMany с voidedAt:null в WHERE переоценивается Postgres заново
    // после снятия блокировки (EvalPlanQual) — если строку уже аннулировал
    // первый запрос, здесь совпадёт 0 строк.
    const voidResult = await tx.goodsSale.updateMany({
      where: { id: saleId, voidedAt: null },
      data: { voidedAt: new Date() },
    });
    if (voidResult.count === 0) throw new Error("ALREADY_VOIDED");

    const goods = await tx.goods.findUniqueOrThrow({ where: { id: sale.goodsId } });
    const amount = Number(sale.amount);

    if (goods.trackStock) {
      // Тот же лок, что у продажи/довоза/ревизии (аудит 2026-07-26) — тот
      // же класс потерянного обновления против конкурентной ревизии.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${sale.goodsId}:${sale.pointId}`}))`;
      await tx.goodsStock.upsert({
        where: { goodsId_pointId: { goodsId: sale.goodsId, pointId: sale.pointId } },
        create: { goodsId: sale.goodsId, pointId: sale.pointId, quantity: sale.quantity },
        update: { quantity: { increment: sale.quantity } },
      });
    }

    const refundedLegs: { walletId: string; amount: number }[] = [];

    if (sale.paymentMethod === PAYMENT_SPLIT_METHOD) {
      // Разбивка — отменяем КАЖДУЮ долю, не одну (запрос пользователя
      // 2026-07-26): своя компенсирующая MoneyOperation на каждый метод,
      // возврат на кошелёк для доли "abonement".
      const legs = await tx.goodsSalePaymentLeg.findMany({ where: { saleId } });
      for (const leg of legs) {
        const legAmount = Number(leg.amount);
        if (leg.method === "abonement" && leg.walletId) {
          await tx.abonementWallet.update({ where: { id: leg.walletId }, data: { balance: { increment: legAmount } } });
          await tx.abonementTransaction.create({
            data: { walletId: leg.walletId, type: "refund", amount: legAmount, goodsSaleId: sale.id, pointId: sale.pointId, userId },
          });
          refundedLegs.push({ walletId: leg.walletId, amount: legAmount });
        }
        await tx.moneyOperation.create({
          data: {
            tenantId,
            pointId: sale.pointId,
            type: moneyTypeFor(leg.method as GoodsPaymentMethod),
            amount: -legAmount,
            performedByUserId: userId,
          },
        });
      }
    } else {
      if (sale.paymentMethod === "abonement" && sale.walletId) {
        await tx.abonementWallet.update({ where: { id: sale.walletId }, data: { balance: { increment: amount } } });
        await tx.abonementTransaction.create({
          data: { walletId: sale.walletId, type: "refund", amount, goodsSaleId: sale.id, pointId: sale.pointId, userId },
        });
        refundedLegs.push({ walletId: sale.walletId, amount });
      }

      await tx.moneyOperation.create({
        data: {
          tenantId,
          pointId: sale.pointId,
          type: moneyTypeFor(sale.paymentMethod as GoodsPaymentMethod),
          amount: -amount,
          performedByUserId: userId,
        },
      });
    }

    const updated = await tx.goodsSale.findUniqueOrThrow({ where: { id: saleId } });

    await tx.correctionLog.create({
      data: {
        entityType: "GoodsSale",
        entityId: saleId,
        correctedByUserId: userId,
        beforeJson: JSON.parse(JSON.stringify(sale)),
        afterJson: JSON.parse(JSON.stringify(updated)),
        comment: reason,
      },
    });

    return { updated, refundedLegs };
  });

  for (const leg of refundedLegs) {
    await notifyWalletBalanceChange(tenantId, leg.walletId, leg.amount).catch(() => {});
  }
  return updated;
}

interface RevisionLineInput {
  goodsId: string;
  actualQuantity: number;
}

async function reviseGoodsStockInTx(
  tx: Tx,
  params: { tenantId: string; pointId: string; categoryId: string; lines: RevisionLineInput[]; actor: Actor; batchId: string }
) {
  const { tenantId, pointId, categoryId, lines, actor, batchId } = params;

  const category = await tx.goodsCategory.findFirst({ where: { id: categoryId, tenantId, deletedAt: null } });
  if (!category) throw new Error("CATEGORY_NOT_FOUND");

  const revision = await tx.goodsRevision.create({
    data: { tenantId, pointId, categoryId, batchId, performedByOperatorId: actor.operatorId, performedByUserId: actor.userId },
  });

  for (const line of lines) {
    const goods = await tx.goods.findFirst({
      where: { id: line.goodsId, tenantId, categoryId, deletedAt: null, trackStock: true },
    });
    if (!goods) throw new Error("GOODS_NOT_FOUND");

    // Advisory lock по (goodsId, pointId) — ревизия читает текущий остаток и
    // ЗАТЕМ АБСОЛЮТНО его перезаписывает (upsert quantity: actualQuantity,
    // не increment/decrement, как у продажи/довоза) — без лока две почти
    // одновременные ревизии ОДНОГО товара (двойной клик "Сохранить" или два
    // сотрудника разом) обе читали бы один и тот же остаток ДО того, как
    // другая успевала записать свой, и обе создавали бы правдоподобную, но
    // задвоенную/противоречивую строку в GoodsRevisionLine — итоговый остаток
    // остаётся плаузибельным, аудиторский след нет (аудит 2026-07-25).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${goods.id}:${pointId}`}))`;

    const stock = await tx.goodsStock.findUnique({ where: { goodsId_pointId: { goodsId: goods.id, pointId } } });
    const calculatedQuantity = stock?.quantity ?? 0;

    await tx.goodsRevisionLine.create({
      data: { revisionId: revision.id, goodsId: goods.id, calculatedQuantity, actualQuantity: line.actualQuantity },
    });

    await tx.goodsStock.upsert({
      where: { goodsId_pointId: { goodsId: goods.id, pointId } },
      create: { goodsId: goods.id, pointId, quantity: line.actualQuantity },
      update: { quantity: line.actualQuantity },
    });
  }

  return revision;
}

/**
 * Ревизия остатков сразу по нескольким категориям одним коммитом (запрос
 * пользователя 2026-07-19: пройти по нескольким категориям, меняя остатки,
 * и нажать общее "Сохранить" один раз) — один GoodsRevision на категорию
 * (архитектура категория=ревизия не меняется), но все создаются в ОДНОЙ
 * транзакции (либо сохраняются все категории, либо ни одна) и делят общий
 * batchId — так История ревизий группирует их в одну плашку вместо одной
 * на категорию.
 */
export async function reviseGoodsStockBatch(params: {
  tenantId: string;
  pointId: string;
  groups: { categoryId: string; lines: RevisionLineInput[] }[];
  actor: Actor;
}) {
  const { tenantId, pointId, groups, actor } = params;
  const batchId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const revisions = [];
    for (const group of groups) {
      revisions.push(await reviseGoodsStockInTx(tx, { tenantId, pointId, categoryId: group.categoryId, lines: group.lines, actor, batchId }));
    }
    return revisions;
  });
}

export interface GoodsCashBreakdown {
  cash: number;
  mobile: number;
  abonement: number;
}

/**
 * Расчётная выручка Товаров с прошлой сверки этой точки (docs/spec/09-goods.md,
 * "Сверка кассы") — сумма GoodsSale по способам оплаты, исключая
 * аннулированные. НЕ хранится нигде — считается на лету при каждом обращении
 * (тот же принцип, что ZoneSubmission.calculatedRevenue).
 */
export async function calculateGoodsCashSince(
  tenantId: string,
  pointId: string
): Promise<GoodsCashBreakdown & { sinceReconciliationId: string | null }> {
  const lastReconciliation = await prisma.goodsReconciliation.findFirst({
    where: { tenantId, pointId },
    orderBy: { occurredAt: "desc" },
  });

  const occurredFilter = lastReconciliation ? { occurredAt: { gt: lastReconciliation.occurredAt } } : {};

  const sales = await prisma.goodsSale.groupBy({
    by: ["paymentMethod"],
    where: {
      tenantId,
      pointId,
      voidedAt: null,
      // Разбитые продажи (paymentMethod="split") считаются отдельно, по
      // долям (GoodsSalePaymentLeg) ниже — иначе вся их сумма легла бы в
      // несуществующий бакет "split" и выпала бы из кассы целиком.
      paymentMethod: { not: PAYMENT_SPLIT_METHOD },
      ...occurredFilter,
    },
    _sum: { amount: true },
  });
  const legs = await prisma.goodsSalePaymentLeg.groupBy({
    by: ["method"],
    where: { sale: { tenantId, pointId, voidedAt: null, ...occurredFilter } },
    _sum: { amount: true },
  });

  const byMethod = new Map(sales.map((s) => [s.paymentMethod, Number(s._sum.amount ?? 0)]));
  for (const leg of legs) {
    byMethod.set(leg.method, (byMethod.get(leg.method) ?? 0) + Number(leg._sum.amount ?? 0));
  }
  return {
    cash: byMethod.get("cash") ?? 0,
    mobile: byMethod.get("mobile") ?? 0,
    abonement: byMethod.get("abonement") ?? 0,
    sinceReconciliationId: lastReconciliation?.id ?? null,
  };
}

export class ReconciliationChangedError extends Error {}

/**
 * Сверка кассы — хранит только введённое человеком (actualCash/actualMobile),
 * расчёт всегда пересчитывается заново (см. calculateGoodsCashSince). Сама
 * НЕ создаёт MoneyOperation — продажи уже создали свои в момент продажи.
 *
 * expectedSinceReconciliationId — то, что клиент видел в calculateGoodsCashSince
 * при открытии формы (аудит 2026-07-24: между GET расчёта и этим POST всегда
 * есть реальная пауза — человек физически пересчитывает кассу, — за это время
 * кто-то другой (второй оператор на том же устройстве через пересменку, или
 * владелец параллельно) мог уже сверить кассу первым. Без проверки оба POST
 * создали бы отдельные GoodsReconciliation за один и тот же, уже частично
 * перекрывающийся период — задвоение истории и два конфликтующих уведомления.
 * CAS здесь — не блокировка (её тут физически быть не может, человек
 * считает деньги руками), а просто честный отказ "кто-то уже сверил, обнови
 * экран" вместо молчаливого дубля.
 */
export async function reconcileGoodsCash(params: {
  tenantId: string;
  pointId: string;
  actualCash: number;
  actualMobile: number;
  actor: Actor;
  expectedSinceReconciliationId?: string | null;
}) {
  const { tenantId, pointId, actualCash, actualMobile, actor, expectedSinceReconciliationId } = params;

  return prisma.$transaction(async (tx) => {
    // Лок по pointId — тот же приём, что у ревизии/инкассации (сама
    // проверка+запись атомарны, второй параллельный POST ждёт коммита
    // первого и видит уже актуальный "текущий последний" при своей проверке).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pointId}))`;

    if (expectedSinceReconciliationId !== undefined) {
      const current = await tx.goodsReconciliation.findFirst({
        where: { tenantId, pointId },
        orderBy: { occurredAt: "desc" },
        select: { id: true },
      });
      if ((current?.id ?? null) !== expectedSinceReconciliationId) {
        throw new ReconciliationChangedError();
      }
    }

    return tx.goodsReconciliation.create({
      data: {
        tenantId,
        pointId,
        actualCash,
        actualMobile,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });
  });
}
