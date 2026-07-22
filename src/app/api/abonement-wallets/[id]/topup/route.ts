import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { adjustWalletBalance } from "@/lib/abonement";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Произвольное пополнение существующего кошелька ВЛАДЕЛЬЦЕМ — не кассовая
// операция (см. комментарий в /api/abonement-wallets/route.ts). Продажа
// плана владельцу недоступна — см. /api/operator/abonements/[id]/topup.
export async function POST(request: Request, ctx: RouteContext<"/api/abonement-wallets/[id]/topup">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const { id: walletId } = await ctx.params;

  const wallet = await prisma.abonementWallet.findFirst({ where: { id: walletId, tenantId: owner.tenantId } });
  if (!wallet) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Укажите сумму" }, { status: 400 });
  }

  const updated = await adjustWalletBalance(walletId, amount, owner.user.id);
  return NextResponse.json({
    id: updated.id,
    phone: updated.phone,
    name: updated.name,
    balance: Number(updated.balance),
    createdAt: updated.createdAt,
  });
}
