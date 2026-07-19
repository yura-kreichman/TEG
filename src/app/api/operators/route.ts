import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPackageLimit } from "@/lib/packages";
import { requireOwner } from "@/lib/require-owner";
import { hashPin } from "@/lib/auth";
import { isPinTakenInTenant } from "@/lib/operator-auth";

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

  const operatorCount = await prisma.operator.count({ where: { tenantId: owner.tenantId } });
  const limitError = await checkPackageLimit(owner.tenantId, "maxOperators", operatorCount);
  if (limitError) return limitError;

  if (await isPinTakenInTenant(owner.tenantId, pin)) {
    return NextResponse.json(
      { error: "Такой ПИН-код уже занят другим оператором" },
      { status: 409 }
    );
  }

  const operator = await prisma.operator.create({
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

  return NextResponse.json(
    { id: operator.id, name: operator.name, active: operator.active },
    { status: 201 }
  );
}
