import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { payGoodsHeldOrder, GOODS_PAYMENT_METHODS, type GoodsPaymentMethod } from "@/lib/goods";
import { InsufficientBalanceError } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { InvalidPaymentSplitError, type PaymentLegInput } from "@/lib/payment-split";

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

// "Оплатить" отложенный заказ — та же схема тела запроса (paymentMethod/
// walletId/legs), что и обычная продажа корзины (/api/operator/goods/sale/cart),
// намеренно: клиентский код bottom sheet переиспользует один и тот же UI
// выбора способа оплаты для обоих случаев.
export async function POST(request: Request, ctx: RouteContext<"/api/operator/goods/held-orders/[id]/pay">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(opCtx.operator.tenantId, "goodsEnabled")) || !opCtx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const paymentMethod = body.paymentMethod;
  const walletId: string | undefined = typeof body.walletId === "string" ? body.walletId : undefined;
  const legs = parseLegs(body.legs);

  if (!legs && !isGoodsPaymentMethod(paymentMethod)) {
    return NextResponse.json({ error: "Укажите способ оплаты" }, { status: 400 });
  }
  if (!legs && paymentMethod === "abonement" && !walletId) {
    return NextResponse.json({ error: "Выберите кошелёк клиента" }, { status: 400 });
  }
  const usesBalance = legs ? legs.some((l) => l.method === "abonement") : paymentMethod === "abonement";
  if (usesBalance) {
    // Те же две серверные проверки, что и у обычной продажи (см.
    // /api/operator/goods/sale/cart/route.ts).
    if (!(await isModuleEnabled(opCtx.operator.tenantId, "clientsEnabled"))) {
      return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: opCtx.operator.tenantId },
      select: { goodsAllowBalancePayment: true },
    });
    if (!tenant?.goodsAllowBalancePayment) {
      return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
    }
  }

  try {
    const sold = await payGoodsHeldOrder({
      tenantId: opCtx.operator.tenantId,
      pointId: opCtx.point.id,
      orderId: id,
      paymentMethod: legs ? "cash" : paymentMethod,
      walletId,
      legs,
      actor: { operatorId: opCtx.operator.id },
    });
    const total = Math.round(sold.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
    return NextResponse.json({ items: sold, total });
  } catch (err) {
    if (err instanceof InvalidPaymentSplitError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof InsufficientBalanceError) {
      const effectiveWalletId = legs?.find((l) => l.method === "abonement")?.walletId ?? walletId;
      const wallet = effectiveWalletId
        ? await prisma.abonementWallet.findFirst({ where: { id: effectiveWalletId, tenantId: opCtx.operator.tenantId } })
        : null;
      return NextResponse.json(
        { error: "Недостаточно средств на балансе", balance: wallet ? Number(wallet.balance) : 0 },
        { status: 400 }
      );
    }
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "EMPTY_CART") {
      return NextResponse.json({ error: "Заказ пуст" }, { status: 400 });
    }
    throw err;
  }
}
