import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPackageLimit } from "@/lib/packages";
import { requireOwner } from "@/lib/require-owner";
import { isZoneAccountingMode } from "@/lib/results-calc";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

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
    include: { tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" } }, assets: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ zones, pointName: point.name, pointActive: point.active });
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

  // Счёт+проверка+создание под локом (аудит 2026-07-24) — maxZones считается
  // по всему тенанту, лимит той же природы, что и у Точек, лочимся по
  // tenantId, тот же паттерн, что /api/points POST.
  const resolvedAccountingMode = isZoneAccountingMode(accountingMode) ? accountingMode : "counters";
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.tenantId}))`;
    const zoneCount = await tx.zone.count({ where: { point: { tenantId: owner.tenantId } } });
    const limitError = await checkPackageLimit(owner.tenantId, "maxZones", zoneCount);
    if (limitError) return { ok: false as const, limitError };

    const zone = await tx.zone.create({
      data: {
        pointId,
        name: name.trim(),
        iconKey: typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null,
        accountingMode: resolvedAccountingMode,
      },
    });
    return { ok: true as const, zone };
  });
  if (!result.ok) return result.limitError;
  const zone = result.zone;

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ id: zone.id, name: zone.name }, { status: 201 });
}
