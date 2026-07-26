import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { sellGoods, GOODS_PAYMENT_METHODS, type GoodsPaymentMethod } from "@/lib/goods";
import { InsufficientBalanceError } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { validateSplitLegs, InvalidPaymentSplitError, type PaymentLegInput } from "@/lib/payment-split";

function isGoodsPaymentMethod(value: unknown): value is GoodsPaymentMethod {
  return typeof value === "string" && (GOODS_PAYMENT_METHODS as readonly string[]).includes(value);
}

function parseLegs(value: unknown): PaymentLegInput[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((raw) => {
    const l = raw as { method?: unknown; amount?: unknown; walletId?: unknown };
    return {
      method: typeof l?.method === "string" ? l.method : "",
      amount: Number(l?.amount),
      walletId: typeof l?.walletId === "string" ? l.walletId : undefined,
    };
  });
}

// Продажа (docs/spec/09-goods.md, "Продажа") — только с тумблером
// goodsAccess. Все денежные расчёты — на сервере (цена берётся из Goods, не
// из тела запроса).
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.operator.tenantId, "goodsEnabled")) || !ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const goodsId: string = typeof body.goodsId === "string" ? body.goodsId : "";
  const quantity = Number(body.quantity);
  const paymentMethod = body.paymentMethod;
  const walletId: string | undefined = typeof body.walletId === "string" ? body.walletId : undefined;
  // Разбивка оплаты (запрос пользователя 2026-07-26) — необязательный
  // массив долей вместо одного paymentMethod; при наличии проверяется
  // отдельно, ниже.
  const legs = parseLegs(body.legs);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "Укажите количество" }, { status: 400 });
  }
  if (!legs && !isGoodsPaymentMethod(paymentMethod)) {
    return NextResponse.json({ error: "Укажите способ оплаты" }, { status: 400 });
  }
  if (!legs && paymentMethod === "abonement" && !walletId) {
    return NextResponse.json({ error: "Выберите кошелёк клиента" }, { status: 400 });
  }
  const usesBalance = legs ? legs.some((l) => l.method === "abonement") : paymentMethod === "abonement";
  if (usesBalance) {
    // Настройки → Система (запрос пользователя 2026-07-20) — серверная
    // проверка, не только скрытие кнопки в UI, тот же принцип, что у
    // Operator.goodsAccess выше. clientsEnabled — отдельная, более общая
    // проверка (запрос пользователя 2026-07-22: "раз не будет клиентов то
    // не будет и метода оплаты Балансом" — везде, не только в Товарах),
    // добавляется К goodsAllowBalancePayment, а не заменяет её.
    if (!(await isModuleEnabled(ctx.operator.tenantId, "clientsEnabled"))) {
      return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.operator.tenantId },
      select: { goodsAllowBalancePayment: true },
    });
    if (!tenant?.goodsAllowBalancePayment) {
      return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
    }
  }
  if (legs) {
    try {
      const goods = await prisma.goods.findFirst({ where: { id: goodsId, tenantId: ctx.operator.tenantId } });
      if (!goods) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
      validateSplitLegs(legs, Number(goods.price) * quantity, GOODS_PAYMENT_METHODS);
    } catch (err) {
      if (err instanceof InvalidPaymentSplitError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  try {
    const sale = await sellGoods({
      tenantId: ctx.operator.tenantId,
      pointId: ctx.point.id,
      goodsId,
      quantity,
      paymentMethod: legs ? "cash" : paymentMethod,
      walletId,
      legs,
      actor: { operatorId: ctx.operator.id },
    });
    return NextResponse.json({ id: sale.id, amount: Number(sale.amount) }, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      // tenantId в where обязателен (аудит 2026-07-25, повторная проверка):
      // без него подставленный/угаданный walletId ЧУЖОГО тенанта всё равно
      // корректно проваливался бы в InsufficientBalanceError (spendWalletTx
      // сам скопирован по tenantId), но этот catch-блок без фильтра читал
      // бы чужой кошелёк напрямую и возвращал его реальный баланс в ответе —
      // утечка баланса клиента чужого тенанта.
      const effectiveWalletId = legs?.find((l) => l.method === "abonement")?.walletId ?? walletId;
      const wallet = effectiveWalletId
        ? await prisma.abonementWallet.findFirst({ where: { id: effectiveWalletId, tenantId: ctx.operator.tenantId } })
        : null;
      return NextResponse.json(
        { error: "Недостаточно средств на балансе", balance: wallet ? Number(wallet.balance) : 0 },
        { status: 400 }
      );
    }
    if (err instanceof Error && err.message === "GOODS_NOT_FOUND") {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }
    // Узкое окно (аудит 2026-07-26): владелец мог поменять цену товара между
    // ранней проверкой выше (75-86) и повторной, авторитетной валидацией
    // внутри транзакции sellGoods — редко, но не 500 же отдавать.
    if (err instanceof InvalidPaymentSplitError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
