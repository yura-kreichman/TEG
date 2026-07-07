import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// "Бизнес: расходы и прибыль" и текущий остаток "сколько наличных должно быть
// на точке" (docs/spec/02-money.md) — оба считаются из единого журнала
// MoneyOperation, без отдельного хранения остатков.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const zones = await prisma.zone.findMany({
    where: { point: { tenantId: owner.tenantId } },
    include: { point: true },
    orderBy: [{ point: { createdAt: "asc" } }, { createdAt: "asc" }],
  });

  const operations = await prisma.moneyOperation.findMany({
    where: { tenantId: owner.tenantId },
  });

  const balanceByZone = new Map<string, number>();
  let totalRevenue = 0;
  let totalExpense = 0;

  for (const op of operations) {
    const amount = Number(op.amount);
    balanceByZone.set(op.zoneId, (balanceByZone.get(op.zoneId) ?? 0) + amount);
    if (op.type === "revenue") totalRevenue += amount;
    if (op.type === "expense") totalExpense += amount; // stored negative
  }

  const zoneBalances = zones.map((zone) => ({
    zoneId: zone.id,
    zoneName: zone.name,
    pointId: zone.pointId,
    pointName: zone.point.name,
    balance: Math.round((balanceByZone.get(zone.id) ?? 0) * 100) / 100,
  }));

  return NextResponse.json({
    zoneBalances,
    business: {
      revenue: Math.round(totalRevenue * 100) / 100,
      expense: Math.round(totalExpense * 100) / 100,
      profit: Math.round((totalRevenue + totalExpense) * 100) / 100,
    },
  });
}
