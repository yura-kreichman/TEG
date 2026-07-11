import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { getOpenShift, isTimeTrackingMode } from "@/lib/work-time";

export async function GET(_request: Request, ctx: RouteContext<"/api/operators/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const operator = await prisma.operator.findUnique({
    where: { id },
    include: { allowedZones: { select: { id: true, name: true, pointId: true } } },
  });
  if (!operator || operator.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  // Для предупреждения владельцу перед деактивацией (docs/spec/05-work-time.md,
  // "РЕЖИМ УЧЁТА ВРЕМЕНИ") — деактивация не блокируется, но открытая смена
  // "осиротеет" (оператор больше не сможет её закрыть сам), стоит показать.
  const hasOpenShift = (await getOpenShift(id)) !== null;

  return NextResponse.json({
    id: operator.id,
    name: operator.name,
    active: operator.active,
    avatarUrl: operator.avatarUrl,
    iconKey: operator.iconKey,
    colorTag: operator.colorTag,
    allZonesAccess: operator.allZonesAccess,
    allowedZones: operator.allowedZones,
    timeTrackingMode: operator.timeTrackingMode,
    overdraftAllowed: operator.overdraftAllowed,
    hasOpenShift,
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/operators/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const operator = await prisma.operator.findUnique({ where: { id } });
  if (!operator || operator.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { name, avatarUrl, iconKey, active, allZonesAccess, zoneIds, colorTag, timeTrackingMode, overdraftAllowed } =
    await request.json();
  const data: {
    name?: string;
    avatarUrl?: string | null;
    iconKey?: string | null;
    active?: boolean;
    allZonesAccess?: boolean;
    allowedZones?: { set: { id: string }[] };
    colorTag?: string | null;
    timeTrackingMode?: string;
    overdraftAllowed?: boolean;
  } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Имя оператора обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (colorTag !== undefined) {
    data.colorTag = typeof colorTag === "string" && colorTag.trim() ? colorTag.trim() : null;
  }
  if (avatarUrl !== undefined) {
    const nextAvatarUrl = typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl.trim() : null;
    if (operator.avatarUrl && operator.avatarUrl !== nextAvatarUrl) {
      await deleteUploadedImage(operator.avatarUrl);
    }
    data.avatarUrl = nextAvatarUrl;
  }
  if (iconKey !== undefined) {
    data.iconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение active" }, { status: 400 });
    }
    data.active = active;
  }
  if (allZonesAccess !== undefined) {
    if (typeof allZonesAccess !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение allZonesAccess" }, { status: 400 });
    }
    data.allZonesAccess = allZonesAccess;
  }
  if (zoneIds !== undefined) {
    if (!Array.isArray(zoneIds) || !zoneIds.every((z) => typeof z === "string")) {
      return NextResponse.json({ error: "Некорректный список зон" }, { status: 400 });
    }
    const validCount = zoneIds.length
      ? await prisma.zone.count({ where: { id: { in: zoneIds }, point: { tenantId: owner.tenantId } } })
      : 0;
    if (validCount !== zoneIds.length) {
      return NextResponse.json({ error: "Одна из зон не найдена" }, { status: 400 });
    }
    data.allowedZones = { set: zoneIds.map((zoneId: string) => ({ id: zoneId })) };
  }
  if (timeTrackingMode !== undefined) {
    if (!isTimeTrackingMode(timeTrackingMode)) {
      return NextResponse.json({ error: "Некорректный режим учёта времени" }, { status: 400 });
    }
    // Уводить режим из-под открытой смены нельзя — в "ручном" у оператора
    // больше не будет кнопки "Закончить смену", чтобы её закрыть самому.
    if (timeTrackingMode !== "auto" && (await getOpenShift(id))) {
      return NextResponse.json(
        { error: "У оператора сейчас открыта смена — сначала закройте её (в табеле), потом меняйте режим" },
        { status: 409 }
      );
    }
    data.timeTrackingMode = timeTrackingMode;
  }
  if (overdraftAllowed !== undefined) {
    if (typeof overdraftAllowed !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение overdraftAllowed" }, { status: 400 });
    }
    data.overdraftAllowed = overdraftAllowed;
  }

  await prisma.operator.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/operators/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const operator = await prisma.operator.findUnique({ where: { id } });
  if (!operator || operator.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  // Operators referenced by historical records (results submissions / money
  // operations) can't be hard-deleted without orphaning that history — deactivate
  // instead (see /api/operators/[id]/deactivate). Only a never-used operator can
  // actually be removed.
  const [submissionCount, moneyOpCount] = await Promise.all([
    prisma.resultsSubmission.count({ where: { operatorId: id } }),
    prisma.moneyOperation.count({ where: { performedByOperatorId: id } }),
  ]);
  if (submissionCount > 0 || moneyOpCount > 0) {
    return NextResponse.json(
      {
        error:
          "У этого оператора есть история сдач итогов/операций — его нельзя удалить безвозвратно, только деактивировать.",
      },
      { status: 409 }
    );
  }

  await prisma.operator.delete({ where: { id } });
  await deleteUploadedImage(operator.avatarUrl);
  return NextResponse.json({ ok: true });
}
