import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { getZoneBalances } from "@/lib/zone-balance";
import { distributeCollectionWhole } from "@/lib/collection-split";

// Общая инкассация точки, но вносит владелец (запрос пользователя
// 2026-07-15: "как и у Сотрудника") — тот же принцип, что у оператора
// (/api/operator/collection/general): один общий итог, сервер сам делит его
// между зонами точки пропорционально их текущему остатку и пишет обычные
// zone-level операции collection.
export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/collection/general">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Math.round(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zones = await prisma.zone.findMany({ where: { pointId } });
  if (zones.length === 0) {
    return NextResponse.json({ error: "На точке нет зон" }, { status: 400 });
  }

  const balanceByZone = await getZoneBalances(zones.map((z) => z.id));
  const weights = zones.map((z) => balanceByZone.get(z.id) ?? 0);
  const shares = distributeCollectionWhole(amountNumber, weights);

  const rows = zones
    .map((zone, i) => ({
      tenantId: owner.tenantId,
      zoneId: zone.id,
      type: "collection",
      amount: -Math.abs(shares[i]),
      performedByUserId: owner.user.id,
    }))
    .filter((row) => row.amount !== 0);

  if (rows.length > 0) {
    await prisma.moneyOperation.createMany({ data: rows });
  }

  return NextResponse.json({ ok: true });
}
