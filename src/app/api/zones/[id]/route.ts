import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { isZoneAccountingMode } from "@/lib/results-calc";

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
    prisma.tariff.findMany({ where: { zoneId: id, deletedAt: null }, orderBy: { order: "asc" } }),
    prisma.asset.findMany({ where: { zoneId: id }, orderBy: { sortOrder: "asc" } }),
  ]);

  const submissionCount = await prisma.zoneSubmission.count({ where: { zoneId: id } });

  return NextResponse.json({
    id: zone.id,
    name: zone.name,
    iconKey: zone.iconKey,
    accountingMode: zone.accountingMode,
    modeLocked: submissionCount > 0,
    active: zone.active,
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

  const { name, iconKey, accountingMode, active } = await request.json();
  const data: { name?: string; iconKey?: string | null; accountingMode?: string; active?: boolean } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название зоны обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (iconKey !== undefined) {
    data.iconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
  }
  if (accountingMode !== undefined) {
    if (!isZoneAccountingMode(accountingMode)) {
      return NextResponse.json({ error: "Некорректный режим учёта" }, { status: 400 });
    }
    const submissionCount = await prisma.zoneSubmission.count({ where: { zoneId: id } });
    if (submissionCount > 0) {
      return NextResponse.json(
        { error: "У зоны уже есть сдачи итогов — режим учёта менять нельзя." },
        { status: 409 }
      );
    }
    data.accountingMode = accountingMode;
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение active" }, { status: 400 });
    }
    data.active = active;
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
