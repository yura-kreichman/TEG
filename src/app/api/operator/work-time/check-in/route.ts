import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getOpenShift, hasNoResultsToday } from "@/lib/work-time";
import { formatShiftStartWindow, isWithinShiftStartWindow } from "@/lib/business-day";
import { dispatchShiftCheckin } from "@/lib/summary-channels/dispatch";

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
    select: { defaultShiftStartTime: true, earlyToleranceMinutes: true, lateToleranceMinutes: true, timezone: true },
  });
  // Персональное исключение (запрос пользователя 2026-07-14) — например,
  // студент, который выходит на пару часов вечером: общее тенантное окно
  // на него не рассчитано, владелец включает флаг в "Настройки оператора",
  // и проверка для этого оператора не выполняется вовсе.
  if (
    tenant &&
    !operator.skipShiftStartWindow &&
    !isWithinShiftStartWindow(
      tenant.defaultShiftStartTime,
      tenant.earlyToleranceMinutes,
      tenant.lateToleranceMinutes,
      startAt,
      tenant.timezone
    )
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

  // Двойной тап "Начать смену" (аудит 2026-07-25, финальный проход) — DB-level
  // частичный уникальный индекс Shift_operatorId_open_unique уже гарантированно
  // не даёт создать вторую открытую смену (getOpenShift выше — только быстрый
  // оптимистичный отказ, не защита сама по себе), но раньше проигравший запрос
  // получал сырой необработанный P2002/500 вместо понятной ошибки.
  let shift;
  try {
    shift = await prisma.shift.create({
      data: { tenantId: point.tenantId, operatorId: operator.id, pointId: point.id, startAt, endAt: null, isOpen: true },
    });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Смена уже начата" }, { status: 409 });
    }
    throw err;
  }
  const noResultsToday = await hasNoResultsToday(point, operator, startAt, tenant?.timezone ?? "UTC");

  dispatchShiftCheckin(point.tenantId, operator.name, point.name, operator.id).catch((err) =>
    console.error("shift checkin push dispatch failed", err)
  );

  return NextResponse.json({ shift: { id: shift.id, startAt: shift.startAt }, noResultsToday });
}
