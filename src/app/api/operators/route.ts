import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPackageLimit } from "@/lib/packages";
import { requireOwner } from "@/lib/require-owner";
import { hashPin } from "@/lib/auth";
import { isOwnerPinInTenant, isPinTakenInTenant } from "@/lib/operator-auth";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const operators = await prisma.operator.findMany({
    where: { tenantId: owner.tenantId },
    select: {
      id: true,
      name: true,
      active: true,
      avatarUrl: true,
      iconKey: true,
      colorTag: true,
      allZonesAccess: true,
      allowedZones: { select: { id: true, name: true } },
      timeTrackingMode: true,
      goodsAccess: true,
      createdAt: true,
    },
    orderBy: { sortOrder: "asc" },
  });

  // Для мигающего значка "открыта смена" в авто-режиме (docs/spec/05-work-time.md)
  // — один запрос на весь список вместо N+1 (getOpenShift() из lib/work-time
  // рассчитан на одного оператора, здесь список).
  const openShifts = await prisma.shift.findMany({
    where: { operatorId: { in: operators.map((o) => o.id) }, isOpen: true },
    select: { operatorId: true },
  });
  const openShiftOperatorIds = new Set(openShifts.map((s) => s.operatorId));

  return NextResponse.json({
    operators: operators.map((o) => ({ ...o, hasOpenShift: openShiftOperatorIds.has(o.id) })),
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { name, pin } = await request.json();

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Имя оператора обязательно" }, { status: 400 });
  }
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(
      { error: "ПИН-код должен состоять из 4-6 цифр" },
      { status: 400 }
    );
  }

  if (await isPinTakenInTenant(owner.tenantId, pin)) {
    return NextResponse.json(
      { error: "Такой ПИН-код уже занят другим оператором" },
      { status: 409 }
    );
  }

  // Не должен совпасть с личным ПИНом Владельца (см. комментарий у
  // isOwnerPinInTenant в lib/operator-auth.ts).
  if (await isOwnerPinInTenant(owner.tenantId, pin)) {
    return NextResponse.json(
      { error: "Этот ПИН-код совпадает с личным ПИН-кодом Владельца, выберите другой" },
      { status: 409 }
    );
  }

  // pg_advisory_xact_lock(hashtext(...)) — тот же паттерн, что уже применён
  // в POST /api/points, /api/points/[id]/zones, /api/zones/[id]/assets
  // (аудит 2026-07-24). Здесь его не было (аудит 2026-07-27, второй раунд,
  // реальная гонка): два параллельных запроса у лимита N оба читали
  // operatorCount=N-1 ДО того, как первый успевал создать оператора — оба
  // проходили проверку, лимит пакета молча превышался навсегда.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.tenantId}))`;
    const operatorCount = await tx.operator.count({ where: { tenantId: owner.tenantId } });
    const limitError = await checkPackageLimit(owner.tenantId, "maxOperators", operatorCount);
    if (limitError) return { ok: false as const, limitError };

    const operator = await tx.operator.create({
      data: {
        tenantId: owner.tenantId,
        name: name.trim(),
        pin,
        pinHash: await hashPin(pin),
        createdByUserId: owner.user.id,
        // Новый оператор — в конец списка, не перед существующими.
        sortOrder: operatorCount,
      },
    });
    return { ok: true as const, operator };
  });

  if (!result.ok) return result.limitError;

  return NextResponse.json(
    { id: result.operator.id, name: result.operator.name, active: result.operator.active },
    { status: 201 }
  );
}
