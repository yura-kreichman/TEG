import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Реальные названия (зона/точка/активы/тарифы/оператор) для живого
// предпросмотра сводок в редакторах (/settings/summaries/*) — цифры там
// остаются демо-числами (что именно показывать/скрывать проверяется
// тумблерами, не суммами), но названия должны быть настоящими, иначе
// предпросмотр не отражает то, что реально уйдёт в чат. Если у тенанта ещё
// нет точки/зоны/оператора — соответствующее поле возвращается null, и
// экран сам подставляет плейсхолдер "не создан(а)".
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const zone = await prisma.zone.findFirst({
    where: { point: { tenantId: owner.tenantId } },
    orderBy: { createdAt: "asc" },
    include: {
      point: true,
      tariffs: { orderBy: { order: "asc" } },
      assets: { orderBy: { createdAt: "asc" } },
    },
  });

  const point =
    zone?.point ??
    (await prisma.point.findFirst({ where: { tenantId: owner.tenantId }, orderBy: { createdAt: "asc" } }));

  const operator = await prisma.operator.findFirst({
    where: { tenantId: owner.tenantId },
    orderBy: { createdAt: "asc" },
  });

  let zoneNames: string[] = [];
  if (zone) {
    const siblingZones = await prisma.zone.findMany({
      where: { pointId: zone.pointId },
      orderBy: { createdAt: "asc" },
      take: 4,
      select: { name: true },
    });
    zoneNames = siblingZones.map((z) => z.name);
  }

  // Группировка по активу (сначала все тарифы одного актива, потом следующий
  // актив) — так же, как реально строит readingLines в submit-results/route.ts,
  // иначе предпросмотр показывал бы другой порядок строк, чем настоящее сообщение.
  const readingPairs = zone
    ? zone.assets
        .flatMap((asset) => zone.tariffs.map((tariff) => ({ assetName: asset.name, tariffName: tariff.name })))
        .slice(0, 4)
    : [];

  return NextResponse.json({
    pointName: point?.name ?? null,
    zoneName: zone?.name ?? null,
    accountingMode: zone?.accountingMode ?? null,
    readingPairs,
    zoneNames,
    operatorName: operator?.name ?? null,
  });
}
