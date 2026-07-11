import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  calcOperatorBalance,
  calcShiftAccrual,
  getOpenShift,
  getRateForDate,
  hasNoResultsToday,
  validateShift,
} from "@/lib/work-time";
import { dispatchShiftCloseSummary } from "@/lib/summary-channels/dispatch";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { notifyDailyCashLateSubmission } from "@/lib/summary-channels/daily-cash-trigger";

// Check-out (docs/spec/05-work-time.md, "АВТО") — закрывает открытую смену
// (endAt=now). Аванс/премия — тот же bottom sheet, что подтверждает check-out
// на главном экране PWA, необязательны (по умолчанию 0), проверка овердрафта
// как в ручном вводе смены (POST /api/operator/work-time/shifts).
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const openShift = await getOpenShift(operator.id);
  if (!openShift) {
    return NextResponse.json({ error: "Смена не начата" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const advanceAmount = Math.abs(Number(body.advanceAmount) || 0);
  const bonusAmount = Math.abs(Number(body.bonusAmount) || 0);

  const startAt = openShift.startAt;
  const endAt = new Date();
  if (endAt <= startAt) {
    return NextResponse.json({ error: "Некорректное время окончания" }, { status: 400 });
  }

  const rate = await getRateForDate(operator.id, startAt);
  const { minutes, accrued } = calcShiftAccrual(startAt, endAt, rate);

  if (advanceAmount > 0) {
    const balance = await calcOperatorBalance(operator.id);
    // Баланс без учёта начисления ЗА ЭТУ смену ещё не включает её — прибавляем,
    // иначе аванс на первой же смене оператора всегда бы блокировался.
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
  await prisma.shift.update({ where: { id: openShift.id }, data: { endAt, isOpen: false } });

  if (advanceAmount > 0) {
    await prisma.moneyOperation.create({
      data: {
        tenantId: point.tenantId,
        pointId: point.id,
        type: "advance",
        amount: -advanceAmount,
        performedByOperatorId: operator.id,
        beneficiaryOperatorId: operator.id,
        shiftId: openShift.id,
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
        shiftId: openShift.id,
      },
    });
  }

  const balance = await calcOperatorBalance(operator.id);
  const noResultsToday = await hasNoResultsToday(point, operator, endAt);

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
  // "Касса за день" уже отправлена, это досдача (см. POST .../work-time/shifts).
  if (advanceAmount > 0 || bonusAmount > 0) {
    notifyDailyCashLateSubmission(point.id, point.tenantId, startAt).catch((err) =>
      console.error("daily cash late-submission notify failed", err)
    );
  }

  const shiftRow = { id: openShift.id, startAt, endAt, minutes, rate, accrued, advanceAmount, bonusAmount };
  return NextResponse.json({ shift: shiftRow, warnings, noResultsToday, balance });
}
