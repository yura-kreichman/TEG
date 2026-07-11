import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getOpenShift, hasNoResultsToday } from "@/lib/work-time";
import { formatShiftStartWindow, isWithinShiftStartWindow } from "@/lib/business-day";

// Check-in (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА ВРЕМЕНИ") — создаёт
// открытую смену (endAt=null), закрывается позже через
// /api/operator/work-time/check-out. Доступно только операторам с
// timeTrackingMode="auto" (владелец выбирает режим в "Настройки оператора");
// при "manual" смена по-прежнему вводится вручную через
// POST /api/operator/work-time/shifts.
export async function POST() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  if (operator.timeTrackingMode !== "auto") {
    return NextResponse.json({ error: "Для этого оператора включён ручной учёт времени" }, { status: 403 });
  }

  if (await getOpenShift(operator.id)) {
    return NextResponse.json({ error: "Смена уже начата" }, { status: 409 });
  }

  const startAt = new Date();

  const tenant = await prisma.tenant.findUnique({
    where: { id: point.tenantId },
    select: { defaultShiftStartTime: true, earlyToleranceMinutes: true, lateToleranceMinutes: true },
  });
  if (
    tenant &&
    !isWithinShiftStartWindow(tenant.defaultShiftStartTime, tenant.earlyToleranceMinutes, tenant.lateToleranceMinutes, startAt)
  ) {
    const window = formatShiftStartWindow(
      tenant.defaultShiftStartTime,
      tenant.earlyToleranceMinutes,
      tenant.lateToleranceMinutes
    );
    return NextResponse.json(
      { error: `Смену можно начать с ${window.start} до ${window.end}` },
      { status: 403 }
    );
  }

  const shift = await prisma.shift.create({
    data: { tenantId: point.tenantId, operatorId: operator.id, pointId: point.id, startAt, endAt: null, isOpen: true },
  });
  const noResultsToday = await hasNoResultsToday(point, operator, startAt);

  return NextResponse.json({ shift: { id: shift.id, startAt: shift.startAt }, noResultsToday });
}
