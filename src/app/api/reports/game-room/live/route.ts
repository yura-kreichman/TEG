import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// "Сейчас на точке" (docs/spec/04-game-room.md, "Кабинет владельца", п.2) —
// живые открытые пуски по зонам с launchMode="game_room". pointId
// опциональный (тот же приём, что /api/reports/home-summary и /money) —
// отсутствует = весь тенант, задан = одна точка.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pointIdParam = searchParams.get("pointId");

  const zones = await prisma.zone.findMany({
    where: {
      accountingMode: "launches",
      launchMode: "game_room",
      point: { tenantId: owner.tenantId, ...(pointIdParam ? { id: pointIdParam } : {}) },
    },
    select: { id: true, name: true, iconKey: true, pointId: true, point: { select: { name: true } } },
  });
  const zoneIds = zones.map((z) => z.id);
  if (zoneIds.length === 0) {
    return NextResponse.json({ zones: [] });
  }

  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  const [openLaunches, todayCounts] = await Promise.all([
    prisma.launch.findMany({
      where: { zoneId: { in: zoneIds }, isOpen: true },
      include: { asset: { select: { name: true } } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.launch.groupBy({
      by: ["zoneId"],
      where: { zoneId: { in: zoneIds }, startedAt: { gte: dayStart } },
      _count: { _all: true },
    }),
  ]);

  const countByZone = new Map(todayCounts.map((c) => [c.zoneId, c._count._all]));

  return NextResponse.json({
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      iconKey: zone.iconKey,
      pointId: zone.pointId,
      pointName: zone.point.name,
      todayCount: countByZone.get(zone.id) ?? 0,
      openLaunches: openLaunches
        .filter((l) => l.zoneId === zone.id)
        .map((l) => ({
          id: l.id,
          assetName: l.asset?.name ?? null,
          number: l.number,
          label: l.label,
          startedAt: l.startedAt,
        })),
    })),
  });
}
