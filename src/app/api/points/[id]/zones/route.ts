import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPackageLimit } from "@/lib/packages";
import { requireOwner } from "@/lib/require-owner";
import { isZoneAccountingMode } from "@/lib/results-calc";

export async function GET(_request: Request, ctx: RouteContext<"/api/points/[id]/zones">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const zones = await prisma.zone.findMany({
    where: { pointId },
    include: { tariffs: { orderBy: { order: "asc" } }, assets: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ zones, pointName: point.name });
}

export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/zones">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { name, iconKey, accountingMode } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название зоны обязательно" }, { status: 400 });
  }
  if (accountingMode !== undefined && !isZoneAccountingMode(accountingMode)) {
    return NextResponse.json({ error: "Некорректный режим учёта" }, { status: 400 });
  }

  const zoneCount = await prisma.zone.count({ where: { point: { tenantId: owner.tenantId } } });
  const limitError = await checkPackageLimit(owner.tenantId, "maxZones", zoneCount);
  if (limitError) return limitError;

  const zone = await prisma.zone.create({
    data: {
      pointId,
      name: name.trim(),
      iconKey: typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null,
      accountingMode: isZoneAccountingMode(accountingMode) ? accountingMode : "counters",
    },
  });

  return NextResponse.json({ id: zone.id, name: zone.name }, { status: 201 });
}
