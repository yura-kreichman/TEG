import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { sellGoods, GOODS_PAYMENT_METHODS, type GoodsPaymentMethod } from "@/lib/goods";
import { InsufficientBalanceError } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";

function isGoodsPaymentMethod(value: unknown): value is GoodsPaymentMethod {
  return typeof value === "string" && (GOODS_PAYMENT_METHODS as readonly string[]).includes(value);
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

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "Укажите количество" }, { status: 400 });
  }
  if (!isGoodsPaymentMethod(paymentMethod)) {
    return NextResponse.json({ error: "Укажите способ оплаты" }, { status: 400 });
  }
  if (paymentMethod === "abonement" && !walletId) {
    return NextResponse.json({ error: "Выберите кошелёк клиента" }, { status: 400 });
  }
  if (paymentMethod === "abonement") {
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

  try {
    const sale = await sellGoods({
      tenantId: ctx.operator.tenantId,
      pointId: ctx.point.id,
      goodsId,
      quantity,
      paymentMethod,
      walletId,
      actor: { operatorId: ctx.operator.id },
    });
    return NextResponse.json({ id: sale.id, amount: Number(sale.amount) }, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      const wallet = walletId ? await prisma.abonementWallet.findUnique({ where: { id: walletId } }) : null;
      return NextResponse.json(
        { error: "Недостаточно средств на балансе", balance: wallet ? Number(wallet.balance) : 0 },
        { status: 400 }
      );
    }
    if (err instanceof Error && err.message === "GOODS_NOT_FOUND") {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }
    throw err;
  }
}
