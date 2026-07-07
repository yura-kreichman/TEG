import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";

// Размен: владелец фиксирует внесение наличных на точку (docs/spec/02-money.md).
export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/change-fund">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  await prisma.moneyOperation.create({
    data: {
      tenantId: owner.tenantId,
      zoneId,
      type: "change_fund",
      amount: amountNumber,
      performedByUserId: owner.user.id,
    },
  });

  return NextResponse.json({ ok: true });
}
