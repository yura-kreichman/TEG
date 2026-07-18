import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { ABONEMENT_TOPUP_PAYMENT_METHODS, topUpWallet } from "@/lib/abonement";
import { prisma } from "@/lib/prisma";

// Пополнение существующего кошелька (найден по телефону на экране оплаты) —
// например, у клиента не хватает баланса на пуск, пополняет прямо тут.
export async function POST(request: Request, ctx: RouteContext<"/api/operator/abonements/[id]/topup">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id: walletId } = await ctx.params;

  const wallet = await prisma.abonementWallet.findFirst({ where: { id: walletId, tenantId: point.tenantId } });
  if (!wallet) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const abonementId: string | null = typeof body.abonementId === "string" && body.abonementId ? body.abonementId : null;
  const paymentMethod = body.paymentMethod;

  if (!abonementId) {
    return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
  }
  if (!(ABONEMENT_TOPUP_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
  }

  try {
    const updated = await topUpWallet(walletId, {
      tenantId: point.tenantId,
      pointId: point.id,
      abonementId,
      paymentMethod,
      actor: { operatorId: operator.id },
    });
    return NextResponse.json({
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      balance: Number(updated.balance),
      createdAt: updated.createdAt,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ABONEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "Абонемент не найден" }, { status: 400 });
    }
    throw err;
  }
}
