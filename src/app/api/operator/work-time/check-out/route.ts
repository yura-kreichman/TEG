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
import { getPointCashBalance } from "@/lib/zone-balance";
import { dispatchShiftCloseSummary } from "@/lib/summary-channels/dispatch";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { notifyDailyCashLateSubmission, onShiftClosed } from "@/lib/summary-channels/daily-cash-trigger";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";

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

  if (advanceAmount > 0 || bonusAmount > 0) {
    // Аванс И премия, которые сотрудник вводит САМ (без владельца рядом), —
    // физически берутся из кассы точки, обе ограничены её остатком, БЕЗ
    // исключений (решение пользователя 2026-07-15) — этот кап всегда жёсткий,
    // даже с овердрафтом. У владельца наоборот: деньги не из кассы точки,
    // проверка по личному балансу сотрудника + овердрафт — см.
    // /api/operators/[id]/work-time/advance и .../bonus.
    const pointBalance = await getPointCashBalance(point.id);
    if (advanceAmount + bonusAmount > pointBalance) {
      const locale = await resolveLocale();
      return NextResponse.json(
        { error: `Сумма превышает остаток кассы точки (${formatMoney(pointBalance, locale)})` },
        { status: 400 }
      );
    }
  }

  if (advanceAmount > 0) {
    // Вторая, независимая проверка — только для аванса: даже если в кассе
    // точки денег хватает, аванс дополнительно не может превышать личный
    // баланс сотрудника "к выдаче", если только у него не разрешён овердрафт
    // (решение пользователя 2026-07-15) — обе проверки должны пройти.
    const balance = await calcOperatorBalance(operator.id);
    // Баланс без учёта начисления ЗА ЭТУ смену ещё не включает её — прибавляем,
    // иначе аванс на первой же смене оператора всегда бы блокировался.
    const projectedToPayOut = balance.toPayOut + accrued;
    if (!operator.overdraftAllowed && advanceAmount > projectedToPayOut) {
      const locale = await resolveLocale();
      return NextResponse.json(
        { error: `Аванс превышает доступный баланс к выдаче (${formatMoney(projectedToPayOut, locale)})` },
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

  // Закрытие смены само по себе не меняет кассу, но может быть последним,
  // чего не хватало для ПЕРВОЙ отправки (запрос пользователя 2026-07-14: все
  // зоны уже отчитались, а этот оператор был последним с открытой сменой) —
  // всегда, не только при авансе/премии. startAt, не endAt — чтобы совпадать
  // с business-day, к которому notifyDailyCashLateSubmission выше уже
  // отнёс эту же смену.
  onShiftClosed(point.id, point.tenantId, startAt).catch((err) =>
    console.error("daily cash on-shift-closed notify failed", err)
  );

  const shiftRow = { id: openShift.id, startAt, endAt, minutes, rate, accrued, advanceAmount, bonusAmount };
  return NextResponse.json({ shift: shiftRow, warnings, noResultsToday, balance });
}
