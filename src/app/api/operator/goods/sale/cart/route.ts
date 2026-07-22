import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { sellGoodsCart, GOODS_PAYMENT_METHODS, type GoodsPaymentMethod } from "@/lib/goods";
import { InsufficientBalanceError } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";

function isGoodsPaymentMethod(value: unknown): value is GoodsPaymentMethod {
  return typeof value === "string" && (GOODS_PAYMENT_METHODS as readonly string[]).includes(value);
}

interface CartItemInput {
  goodsId?: unknown;
  quantity?: unknown;
}

// Продажа корзины — несколько товаров, один способ оплаты, одна транзакция
// (запрос пользователя 2026-07-21: "такой же принцип корзины должен быть в
// Товарах, а то сейчас можно продавать только по одному товару"). Отдельный
// роут от /api/operator/goods/sale (не переиспользуем его) — тот принимает
// ровно одну позицию и мог использоваться где-то ещё, менять его форму
// рискованнее, чем завести соседний.
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.operator.tenantId, "goodsEnabled")) || !ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawItems = Array.isArray(body.items) ? (body.items as CartItemInput[]) : [];
  const paymentMethod = body.paymentMethod;
  const walletId: string | undefined = typeof body.walletId === "string" ? body.walletId : undefined;

  const items: { goodsId: string; quantity: number }[] = [];
  for (const item of rawItems) {
    const goodsId = typeof item.goodsId === "string" ? item.goodsId : "";
    const quantity = Number(item.quantity);
    if (!goodsId || !Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Некорректная корзина" }, { status: 400 });
    }
    items.push({ goodsId, quantity });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Корзина пуста" }, { status: 400 });
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
    const sold = await sellGoodsCart({
      tenantId: ctx.operator.tenantId,
      pointId: ctx.point.id,
      items,
      paymentMethod,
      walletId,
      actor: { operatorId: ctx.operator.id },
    });
    const total = Math.round(sold.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
    return NextResponse.json({ items: sold, total }, { status: 201 });
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
