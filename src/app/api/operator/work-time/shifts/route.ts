import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  calcOperatorBalance,
  calcShiftAccrual,
  getRateForDate,
  hasNoResultsToday,
  hasOverlappingShift,
  listShiftDetails,
  listStandaloneMoneyOps,
  validateShift,
} from "@/lib/work-time";
import { dispatchShiftCloseSummary } from "@/lib/summary-channels/dispatch";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { notifyDailyCashLateSubmission } from "@/lib/summary-channels/daily-cash-trigger";

export async function GET(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const period =
    fromParam && toParam
      ? {
          from: new Date(`${fromParam}T00:00:00.000Z`),
          to: new Date(new Date(`${toParam}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
        }
      : undefined;

  const shifts = await listShiftDetails(ctx.operator.id, period);
  const standaloneMoneyOps = await listStandaloneMoneyOps(ctx.operator.id, period);
  return NextResponse.json({ shifts, standaloneMoneyOps });
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  // Запрет на уровне API, не только UI (docs/spec/05-work-time.md, "РЕЖИМ
  // УЧЁТА ВРЕМЕНИ"): в авто-режиме время фиксируется только сервером через
  // check-in/check-out, ручной ввод произвольного времени недоступен даже
  // прямым запросом к этому эндпоинту.
  if (operator.timeTrackingMode === "auto") {
    return NextResponse.json(
      { error: "Для этого оператора включён автоматический учёт времени — используйте Начать/Закончить смену" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const startAt = new Date(body.startAt);
  const endAt = new Date(body.endAt);
  const advanceAmount = Math.abs(Number(body.advanceAmount) || 0);
  const bonusAmount = Math.abs(Number(body.bonusAmount) || 0);

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return NextResponse.json({ error: "Некорректное время смены" }, { status: 400 });
  }

  if (await hasOverlappingShift(operator.id, startAt, endAt)) {
    return NextResponse.json({ error: "Смена пересекается с другой вашей сменой" }, { status: 409 });
  }

  if (advanceAmount > 0) {
    const balance = await calcOperatorBalance(operator.id);
    // Аванс вводится в той же форме, что и сама смена — доступный баланс
    // должен уже учитывать начисление ЗА ЭТУ смену, иначе самый первый аванс
    // на самой первой смене оператора всегда бы блокировался (баланс = 0 до
    // того, как смена вообще создана).
    const rate = await getRateForDate(operator.id, startAt);
    const { accrued } = calcShiftAccrual(startAt, endAt, rate);
    const projectedToPayOut = balance.toPayOut + accrued;
    // overdraftAllowed — персональная настройка оператора (docs/spec/05-work-time.md), не тенанта.
    if (!operator.overdraftAllowed && advanceAmount > projectedToPayOut) {
      return NextResponse.json(
        { error: `Аванс превышает доступный баланс к выдаче (${projectedToPayOut.toFixed(2)})` },
        { status: 400 }
      );
    }
  }

  const warnings = validateShift(startAt, endAt);

  const shift = await prisma.shift.create({
    data: { tenantId: point.tenantId, operatorId: operator.id, pointId: point.id, startAt, endAt },
  });

  if (advanceAmount > 0) {
    await prisma.moneyOperation.create({
      data: {
        tenantId: point.tenantId,
        pointId: point.id,
        type: "advance",
        amount: -advanceAmount,
        performedByOperatorId: operator.id,
        beneficiaryOperatorId: operator.id,
        shiftId: shift.id,
      },
    });
  }
  if (bonusAmount > 0) {
    await prisma.moneyOperation.create({
      data: {
        tenantId: point.tenantId,
        pointId: point.id,
        type: "bonus_payout",
        amount: -bonusAmount,
        performedByOperatorId: operator.id,
        beneficiaryOperatorId: operator.id,
        shiftId: shift.id,
      },
    });
  }

  const balance = await calcOperatorBalance(operator.id);
  const noResultsToday = await hasNoResultsToday(point, operator, startAt);

  const rate = await getRateForDate(operator.id, startAt);
  const { minutes, accrued } = calcShiftAccrual(startAt, endAt, rate);

  // "Закрытие смены" (docs/spec/telegram-summaries.md) — по факту ввода
  // смены, как и раньше (docs/spec/05-work-time.md уже описывала этот триггер
  // для старой единой Telegram-сводки; теперь это настраиваемый тип сводки,
  // каналы и состав берутся из ShiftCloseSummarySettings).
  const shiftCloseSettings =
    (await prisma.shiftCloseSummarySettings.findUnique({ where: { tenantId: point.tenantId } })) ??
    SHIFT_CLOSE_SUMMARY_DEFAULTS;
  if (shiftCloseSettings.enabled) {
    dispatchShiftCloseSummary(
      point.tenantId,
      {
        operatorName: operator.name,
        operatorColorTag: operator.colorTag,
        startAt,
        endAt,
        minutes,
        rate,
        accrued,
        advanceAmount,
        bonusAmount,
        toPayOut: balance.toPayOut,
      },
      shiftCloseSettings
    ).catch((err) => console.error("shift close summary dispatch failed", err));
  }

  // Смена с авансом/премией меняет остаток кассы точки — если сегодняшняя
  // "Касса за день" уже отправлена, это досдача.
  if (advanceAmount > 0 || bonusAmount > 0) {
    notifyDailyCashLateSubmission(point.id, point.tenantId, startAt).catch((err) =>
      console.error("daily cash late-submission notify failed", err)
    );
  }

  const shiftRow = { id: shift.id, startAt, endAt, minutes, rate, accrued, advanceAmount, bonusAmount };
  return NextResponse.json({ shift: shiftRow, warnings, noResultsToday, balance });
}
