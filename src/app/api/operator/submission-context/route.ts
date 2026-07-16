import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";

export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { operator, point } = ctx;

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id, active: true }
    : { pointId: point.id, active: true, operatorsWithAccess: { some: { id: operator.id } } };

  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    include: {
      tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" as const } },
      assets: { orderBy: { sortOrder: "asc" as const } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Previous reading per (assetId, tariffId): the latest AssetReading recorded
  // across any past submission, regardless of date — "расчёт всегда от
  // предыдущей сдачи" (docs/spec/01-counters.md). Only meaningful in "counters"
  // mode — "launches" readings aren't a running meter, so there's nothing to
  // look up (previousReadings stays all-zero for those zones).
  const assetIds = zones
    .filter((z) => z.accountingMode === "counters")
    .flatMap((z) => z.assets.map((a) => a.id));
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
  const initialByKey = await getInitialReadingsMap(assetIds);

  // Категории расходов тенанта (запрос пользователя 2026-07-14) — для выбора
  // при вводе расхода на шаге "Расходы" мастера сдачи итогов.
  const expenseCategories = await prisma.expenseCategory.findMany({
    where: { tenantId: point.tenantId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  const result = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    iconKey: zone.iconKey,
    accountingMode: zone.accountingMode,
    launchMode: zone.launchMode,
    tariffs: zone.tariffs.map((t) => ({ id: t.id, name: t.name, price: t.price, order: t.order })),
    assets: zone.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      colorTag: asset.colorTag,
      photoUrl: asset.photoUrl,
      iconKey: asset.iconKey,
      // Деактивированный актив (на ремонте) остаётся видимым оператору, но
      // read-only — в отличие от Zone.active, который скрывает зону целиком
      // (запрос пользователя 2026-07-16).
      active: asset.active,
      previousReadings: Object.fromEntries(
        zone.tariffs.map((t) => {
          const key = `${asset.id}:${t.id}`;
          return [t.id, previousByKey.get(key) ?? initialByKey.get(key) ?? 0];
        })
      ),
    })),
  }));

  return NextResponse.json({
    operatorName: operator.name,
    pointName: point.name,
    zones: result,
    expenseCategories,
  });
}
