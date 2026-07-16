import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// "Сейчас на точке" (docs/spec/04-game-room.md, "Кабинет владельца", п.2) —
// живые открытые пуски по зонам с launchMode="game_room". Группировка — по
// АКТИВУ, не по зоне (запрос пользователя 2026-07-16: "на территории парка
// есть 2 игровые комнаты — это активы", зона лишь владеет режимом, тариф —
// свойство актива). Зона без активов не может иметь пусков вовсе (пуск без
// актива сервер отклоняет — тариф неоткуда взять), поэтому такие зоны просто
// не участвуют в списке — псевдо-актива на всю зону больше нет. pointId
// опциональный (тот же приём, что /api/reports/home-summary и /money) —
// отсутствует = весь тенант.
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
    select: {
      id: true,
      name: true,
      iconKey: true,
      pointId: true,
      point: { select: { name: true } },
      assets: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, iconKey: true, colorTag: true, photoUrl: true } },
    },
  });
  if (zones.length === 0) {
    return NextResponse.json({ assets: [] });
  }
  const zoneIds = zones.map((z) => z.id);

  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  const [openLaunches, todayCounts] = await Promise.all([
    prisma.launch.findMany({
      where: { zoneId: { in: zoneIds }, isOpen: true },
      orderBy: { startedAt: "asc" },
    }),
    prisma.launch.groupBy({
      by: ["zoneId", "assetId"],
      where: { zoneId: { in: zoneIds }, startedAt: { gte: dayStart } },
      _count: { _all: true },
    }),
  ]);

  const countKey = (zoneId: string, assetId: string | null) => `${zoneId}:${assetId ?? "zone"}`;
  const countByKey = new Map(todayCounts.map((c) => [countKey(c.zoneId, c.assetId), c._count._all]));

  const assets = zones.flatMap((zone) =>
    zone.assets.map((asset) => ({
      key: `${zone.id}:${asset.id}`,
      assetId: asset.id,
      name: asset.name,
      iconKey: asset.iconKey,
      colorTag: asset.colorTag,
      photoUrl: asset.photoUrl,
      zoneId: zone.id,
      zoneName: zone.name,
      pointId: zone.pointId,
      pointName: zone.point.name,
      todayCount: countByKey.get(countKey(zone.id, asset.id)) ?? 0,
      openLaunches: openLaunches
        .filter((l) => l.zoneId === zone.id && l.assetId === asset.id)
        .map((l) => ({ id: l.id, number: l.number, label: l.label, startedAt: l.startedAt })),
    }))
  );

  return NextResponse.json({ assets });
}
