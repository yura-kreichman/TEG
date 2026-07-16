import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Список пусков за период с фильтрами — экран владельца "правка/аннулирование"
// (docs/spec/04-game-room.md, "Кабинет владельца", п.3).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const zoneId = searchParams.get("zoneId");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month")); // 1-12

  const zones = await prisma.zone.findMany({
    where: {
      accountingMode: "launches",
      launchMode: "game_room",
      point: { tenantId: owner.tenantId },
      ...(zoneId ? { id: zoneId } : {}),
    },
    select: { id: true },
  });
  const zoneIds = zones.map((z) => z.id);
  if (zoneIds.length === 0) {
    return NextResponse.json({ launches: [] });
  }

  const where: { zoneId: { in: string[] }; startedAt?: { gte: Date; lt: Date } } = { zoneId: { in: zoneIds } };
  if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
    where.startedAt = { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };
  }

  const launches = await prisma.launch.findMany({
    where,
    include: { zone: { select: { name: true } }, asset: { select: { name: true } } },
    orderBy: { startedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    launches: launches.map((l) => ({
      id: l.id,
      zoneId: l.zoneId,
      zoneName: l.zone.name,
      assetName: l.asset?.name ?? null,
      number: l.number,
      label: l.label,
      startedAt: l.startedAt,
      endedAt: l.endedAt,
      amount: l.amount != null ? Number(l.amount) : null,
      voidedAt: l.voidedAt,
    })),
  });
}
