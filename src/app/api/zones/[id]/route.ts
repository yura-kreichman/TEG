import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";

export async function GET(_request: Request, ctx: RouteContext<"/api/zones/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, id);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const [tariffs, assets] = await Promise.all([
    prisma.tariff.findMany({ where: { zoneId: id }, orderBy: { order: "asc" } }),
    prisma.asset.findMany({ where: { zoneId: id }, orderBy: { createdAt: "asc" } }),
  ]);

  return NextResponse.json({
    id: zone.id,
    name: zone.name,
    iconKey: zone.iconKey,
    pointId: zone.pointId,
    pointName: zone.point.name,
    tariffs,
    assets,
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/zones/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, id);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const { name, iconKey } = await request.json();
  const data: { name?: string; iconKey?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название зоны обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (iconKey !== undefined) {
    data.iconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
  }

  await prisma.zone.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/zones/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, id);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  // Same history guard as Point/Operator deletion — a Zone referenced by
  // submissions/money operations can't be hard-deleted without losing that
  // history (ZoneSubmission/MoneyOperation don't cascade from Zone).
  const [submissionCount, moneyOpCount] = await Promise.all([
    prisma.zoneSubmission.count({ where: { zoneId: id } }),
    prisma.moneyOperation.count({ where: { zoneId: id } }),
  ]);
  if (submissionCount > 0 || moneyOpCount > 0) {
    return NextResponse.json(
      { error: "У этой зоны есть история сдач итогов/операций — её нельзя удалить." },
      { status: 409 }
    );
  }

  await prisma.zone.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
