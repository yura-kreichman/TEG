import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { getZonePoolShare } from "@/lib/zone-balance";

// Инкассация по конкретной зоне, но вносит владелец (запрос пользователя
// 2026-07-15: "как и у Сотрудника") — та же операция collection, что и у
// оператора (docs/spec/02-money.md), просто выполненная владельцем. К
// введённой сумме автоматически прибавляется доля этой зоны в "пуле" —
// аванс/премия, которые сотрудник уже забрал с точки после прошлой
// инкассации (lib/zone-balance.ts, getZonePoolShare) — иначе эти деньги
// зависают в журнале зоны навсегда (решение пользователя 2026-07-16).
export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/collection">) {
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

  const poolShare = await getZonePoolShare(zone.pointId, zoneId);
  await prisma.moneyOperation.create({
    data: {
      tenantId: owner.tenantId,
      zoneId,
      type: "collection",
      amount: -(Math.abs(amountNumber) + poolShare),
      performedByUserId: owner.user.id,
    },
  });

  return NextResponse.json({ ok: true, settledPool: poolShare });
}
