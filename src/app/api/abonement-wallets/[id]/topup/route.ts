import { NextResponse } from "next/server";
import { requireOwner, findTenantPoint } from "@/lib/require-owner";
import { ABONEMENT_TOPUP_PAYMENT_METHODS, adjustWalletBalance, topUpWallet } from "@/lib/abonement";
import { prisma } from "@/lib/prisma";

// Пополнение существующего кошелька ВЛАДЕЛЬЦЕМ — аналог
// /api/operator/abonements/[id]/topup, точку указывает явно (см. комментарий
// в /api/abonement-wallets/route.ts).
export async function POST(request: Request, ctx: RouteContext<"/api/abonement-wallets/[id]/topup">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id: walletId } = await ctx.params;

  const wallet = await prisma.abonementWallet.findFirst({ where: { id: walletId, tenantId: owner.tenantId } });
  if (!wallet) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const abonementId: string | null = typeof body.abonementId === "string" && body.abonementId ? body.abonementId : null;
  // Произвольная сумма — только владелец, см. комментарий в
  // /api/abonement-wallets/route.ts.
  const amount: number | null = body.amount != null ? Number(body.amount) : null;
  const pointId: string | null = typeof body.pointId === "string" && body.pointId ? body.pointId : null;
  const paymentMethod = body.paymentMethod;

  if (amount != null) {
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Укажите сумму" }, { status: 400 });
    }
    if (!pointId || !(await findTenantPoint(owner.tenantId, pointId))) {
      return NextResponse.json({ error: "Выберите точку" }, { status: 400 });
    }
    const updated = await adjustWalletBalance(walletId, owner.tenantId, pointId, amount, owner.user.id);
    return NextResponse.json({
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      balance: Number(updated.balance),
    });
  }

  if (!abonementId) {
    return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
  }
  if (!pointId || !(await findTenantPoint(owner.tenantId, pointId))) {
    return NextResponse.json({ error: "Выберите точку" }, { status: 400 });
  }
  if (!(ABONEMENT_TOPUP_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
  }

  try {
    const updated = await topUpWallet(walletId, {
      tenantId: owner.tenantId,
      pointId,
      abonementId,
      paymentMethod,
      actor: { userId: owner.user.id },
    });
    return NextResponse.json({
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      balance: Number(updated.balance),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ABONEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "Абонемент не найден" }, { status: 400 });
    }
    throw err;
  }
}
