import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InsufficientBalanceError } from "@/lib/abonement";

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
    paymentMethod: GoodsPaymentMethod;
    walletId?: string;
    actor: Actor;
  }
) {
  const { tenantId, pointId, goodsId, quantity, paymentMethod, walletId, actor } = params;

  const goods = await tx.goods.findFirst({ where: { id: goodsId, tenantId, deletedAt: null } });
  if (!goods) throw new Error("GOODS_NOT_FOUND");

  const amount = Number(goods.price) * quantity;

  if (goods.trackStock) {
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

  if (paymentMethod === "abonement") {
    const updated = await tx.abonementWallet.updateMany({
      where: { id: walletId, tenantId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (updated.count === 0) throw new InsufficientBalanceError();

    await tx.abonementTransaction.create({
      data: { walletId: walletId!, type: "spend", amount, goodsSaleId: sale.id, pointId, ...actor },
    });
  }

  await tx.moneyOperation.create({
    data: {
      tenantId,
      pointId,
      type: moneyTypeFor(paymentMethod),
      amount,
      performedByOperatorId: actor.operatorId,
      performedByUserId: actor.userId,
    },
  });

  return { sale, amount };
}

export async function sellGoods(params: SellParams) {
  const { tenantId, pointId, goodsId, quantity, paymentMethod, walletId, actor } = params;
  if (paymentMethod === "abonement" && !walletId) throw new Error("WALLET_REQUIRED");

  return prisma.$transaction(async (tx) => {
    const { sale } = await sellOneItemTx(tx, { tenantId, pointId, goodsId, quantity, paymentMethod, walletId, actor });
    return sale;
  });
}

interface SellCartParams {
  tenantId: string;
  pointId: string;
  items: { goodsId: string; quantity: number }[];
  paymentMethod: GoodsPaymentMethod;
  walletId?: string; // только paymentMethod="abonement"
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
  const { tenantId, pointId, items, paymentMethod, walletId, actor } = params;
  if (paymentMethod === "abonement" && !walletId) throw new Error("WALLET_REQUIRED");
  if (items.length === 0) throw new Error("EMPTY_CART");

  return prisma.$transaction(async (tx) => {
    const results: SoldCartLine[] = [];
    for (const item of items) {
      const { sale, amount } = await sellOneItemTx(tx, {
        tenantId,
        pointId,
        goodsId: item.goodsId,
        quantity: item.quantity,
        paymentMethod,
        walletId,
        actor,
      });
      results.push({ id: sale.id, goodsId: item.goodsId, quantity: item.quantity, amount });
    }
    return results;
  });
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
  return prisma.$transaction(async (tx) => {
    const sale = await tx.goodsSale.findFirst({ where: { id: saleId, tenantId } });
    if (!sale) throw new Error("SALE_NOT_FOUND");
    if (sale.voidedAt) throw new Error("ALREADY_VOIDED");

    const goods = await tx.goods.findUniqueOrThrow({ where: { id: sale.goodsId } });
    const amount = Number(sale.amount);

    if (goods.trackStock) {
      await tx.goodsStock.upsert({
        where: { goodsId_pointId: { goodsId: sale.goodsId, pointId: sale.pointId } },
        create: { goodsId: sale.goodsId, pointId: sale.pointId, quantity: sale.quantity },
        update: { quantity: { increment: sale.quantity } },
      });
    }

    if (sale.paymentMethod === "abonement" && sale.walletId) {
      await tx.abonementWallet.update({ where: { id: sale.walletId }, data: { balance: { increment: amount } } });
      await tx.abonementTransaction.create({
        data: { walletId: sale.walletId, type: "refund", amount, goodsSaleId: sale.id, pointId: sale.pointId, userId },
      });
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

    const updated = await tx.goodsSale.update({ where: { id: saleId }, data: { voidedAt: new Date() } });

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

    return updated;
  });
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
export async function calculateGoodsCashSince(tenantId: string, pointId: string): Promise<GoodsCashBreakdown> {
  const lastReconciliation = await prisma.goodsReconciliation.findFirst({
    where: { tenantId, pointId },
    orderBy: { occurredAt: "desc" },
  });

  const sales = await prisma.goodsSale.groupBy({
    by: ["paymentMethod"],
    where: {
      tenantId,
      pointId,
      voidedAt: null,
      ...(lastReconciliation ? { occurredAt: { gt: lastReconciliation.occurredAt } } : {}),
    },
    _sum: { amount: true },
  });

  const byMethod = new Map(sales.map((s) => [s.paymentMethod, Number(s._sum.amount ?? 0)]));
  return {
    cash: byMethod.get("cash") ?? 0,
    mobile: byMethod.get("mobile") ?? 0,
    abonement: byMethod.get("abonement") ?? 0,
  };
}

/**
 * Сверка кассы — хранит только введённое человеком (actualCash/actualMobile),
 * расчёт всегда пересчитывается заново (см. calculateGoodsCashSince). Сама
 * НЕ создаёт MoneyOperation — продажи уже создали свои в момент продажи.
 */
export async function reconcileGoodsCash(params: {
  tenantId: string;
  pointId: string;
  actualCash: number;
  actualMobile: number;
  actor: Actor;
}) {
  const { tenantId, pointId, actualCash, actualMobile, actor } = params;
  return prisma.goodsReconciliation.create({
    data: {
      tenantId,
      pointId,
      actualCash,
      actualMobile,
      performedByOperatorId: actor.operatorId,
      performedByUserId: actor.userId,
    },
  });
}
