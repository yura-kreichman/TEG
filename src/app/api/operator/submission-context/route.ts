import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { operator, point } = ctx;

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id }
    : { pointId: point.id, operatorsWithAccess: { some: { id: operator.id } } };

  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    include: {
      tariffs: { orderBy: { order: "asc" as const } },
      assets: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Previous reading per (assetId, tariffId): the latest AssetReading recorded
  // across any past submission, regardless of date — "расчёт всегда от
  // предыдущей сдачи" (docs/spec/01-counters.md).
  const assetIds = zones.flatMap((z) => z.assets.map((a) => a.id));
  const previousReadings = assetIds.length
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: assetIds } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const previousByKey = new Map<string, number>();
  for (const reading of previousReadings) {
    const key = `${reading.assetId}:${reading.tariffId}`;
    if (!previousByKey.has(key)) previousByKey.set(key, reading.reading);
  }

  const result = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    iconKey: zone.iconKey,
    tariffs: zone.tariffs.map((t) => ({ id: t.id, name: t.name, price: t.price, order: t.order })),
    assets: zone.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      colorTag: asset.colorTag,
      photoUrl: asset.photoUrl,
      iconKey: asset.iconKey,
      previousReadings: Object.fromEntries(
        zone.tariffs.map((t) => [t.id, previousByKey.get(`${asset.id}:${t.id}`) ?? 0])
      ),
    })),
  }));

  return NextResponse.json({ operatorName: operator.name, pointName: point.name, zones: result });
}
