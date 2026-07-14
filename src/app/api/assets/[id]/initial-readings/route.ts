import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

async function findOwnedAsset(tenantId: string, id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: { zone: { include: { point: true, tariffs: { where: { deletedAt: null } } } } },
  });
  if (!asset || asset.zone.point.tenantId !== tenantId) return null;
  return asset;
}

// Начальные (калибровочные) показания счётчика — см. AssetInitialReading в
// schema.prisma и src/lib/asset-initial-readings.ts. Владелец задаёт их для
// актива, который заводится в приложение уже не с нуля (реальный физический
// счётчик), обычно один раз при старте использования.
export async function GET(_request: Request, ctx: RouteContext<"/api/assets/[id]/initial-readings">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await findOwnedAsset(owner.tenantId, id);
  if (!asset) {
    return NextResponse.json({ error: "Актив не найден" }, { status: 404 });
  }

  const initialReadings = await prisma.assetInitialReading.findMany({ where: { assetId: id } });
  const hasRealReadings = (await prisma.assetReading.count({ where: { assetId: id } })) > 0;

  return NextResponse.json({
    tariffs: asset.zone.tariffs.map((t) => ({
      id: t.id,
      name: t.name,
      reading: initialReadings.find((r) => r.tariffId === t.id)?.reading ?? null,
    })),
    hasRealReadings,
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/assets/[id]/initial-readings">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await findOwnedAsset(owner.tenantId, id);
  if (!asset) {
    return NextResponse.json({ error: "Актив не найден" }, { status: 404 });
  }
  if (asset.zone.accountingMode !== "counters") {
    return NextResponse.json({ error: "Начальные показания есть только у зон «По счётчикам»" }, { status: 400 });
  }

  const { readings } = await request.json();
  if (!readings || typeof readings !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const tariffIds = new Set(asset.zone.tariffs.map((t) => t.id));
  const entries = Object.entries(readings as Record<string, unknown>).filter(([tariffId]) => tariffIds.has(tariffId));

  for (const [tariffId, value] of entries) {
    if (value === null || value === "") {
      await prisma.assetInitialReading.deleteMany({ where: { assetId: id, tariffId } });
      continue;
    }
    const reading = Number(value);
    if (!Number.isInteger(reading) || reading < 0 || reading > 9999) {
      return NextResponse.json({ error: "Показание должно быть числом от 0 до 9999" }, { status: 400 });
    }
    await prisma.assetInitialReading.upsert({
      where: { assetId_tariffId: { assetId: id, tariffId } },
      create: { assetId: id, tariffId, reading },
      update: { reading },
    });
  }

  return NextResponse.json({ ok: true });
}
