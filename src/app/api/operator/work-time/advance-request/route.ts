import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { calcOperatorBalance, calcShiftAccrual, getOpenShift, getRateForDate } from "@/lib/work-time";
import { chargeSelfServiceAdvanceToZones, getPointCashBalance } from "@/lib/zone-balance";
import { notifyDailyCashLateSubmission } from "@/lib/summary-channels/daily-cash-trigger";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";

// Самостоятельный запрос аванса/премии В СЕРЕДИНЕ смены, без её закрытия
// (docs/spec/05-work-time.md, "АВАНС": «вводит сам оператор... или отдельно
// в PWA») — раньше в auto-режиме единственная точка входа была bottom sheet
// при check-out (см. /api/operator/work-time/check-out), оператор физически
// не мог попросить аванс, не закрывая смену (пробел, найден аудитом
// 2026-07-24). В manual-режиме этой роли не нужно — там аванс/премия уже
// вводятся вместе с самой формой смены (POST /api/operator/work-time/shifts).
//
// Ровно та же пара проверок и тот же locked-транзакционный паттерн, что и у
// check-out — casса точки СМЕНЫ (openShift.pointId), не текущей точки
// устройства (см. комментарий у check-out/route.ts про роуминг).
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
  const shiftPointId = openShift.pointId;

  const body = await request.json().catch(() => ({}));
  const advanceAmount = Math.abs(Number(body.advanceAmount) || 0);
  const bonusAmount = Math.abs(Number(body.bonusAmount) || 0);
  if (advanceAmount === 0 && bonusAmount === 0) {
    return NextResponse.json({ error: "Укажите сумму" }, { status: 400 });
  }

  // Тот же жёсткий кап без исключений, что и у check-out (решение
  // пользователя 2026-07-15) — быстрый оптимистичный отказ, авторитетная
  // проверка — под локом ниже.
  const pointBalance = await getPointCashBalance(shiftPointId);
  if (advanceAmount + bonusAmount > pointBalance) {
    const locale = await resolveLocale();
    return NextResponse.json(
      { error: `Сумма превышает остаток кассы точки (${formatMoney(pointBalance, locale)})` },
      { status: 400 }
    );
  }

  if (advanceAmount > 0) {
    const rate = await getRateForDate(operator.id, openShift.startAt);
    // Начисление "если бы смена закончилась прямо сейчас" — та же формула,
    // что check-out использует с реальным endAt.
    const { accrued } = calcShiftAccrual(openShift.startAt, new Date(), rate);
    const balance = await calcOperatorBalance(operator.id);
    const projectedToPayOut = balance.toPayOut + accrued;
    if (!operator.overdraftAllowed && advanceAmount > projectedToPayOut) {
      const locale = await resolveLocale();
      return NextResponse.json(
        { error: `Аванс превышает доступный баланс к выдаче (${formatMoney(projectedToPayOut, locale)})` },
        { status: 400 }
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shiftPointId}))`;
    const freshBalance = await getPointCashBalance(shiftPointId);
    if (advanceAmount + bonusAmount > freshBalance) {
      return { ok: false as const, freshBalance };
    }
    if (advanceAmount > 0) {
      await tx.moneyOperation.create({
        data: {
          tenantId: point.tenantId,
          pointId: shiftPointId,
          type: "advance",
          amount: -advanceAmount,
          performedByOperatorId: operator.id,
          beneficiaryOperatorId: operator.id,
          shiftId: openShift.id,
        },
      });
    }
    if (bonusAmount > 0) {
      await tx.moneyOperation.create({
        data: {
          tenantId: point.tenantId,
          pointId: shiftPointId,
          type: "bonus_payout",
          amount: -bonusAmount,
          performedByOperatorId: operator.id,
          beneficiaryOperatorId: operator.id,
          shiftId: openShift.id,
        },
      });
    }
    return { ok: true as const };
  });
  if (!result.ok) {
    const locale = await resolveLocale();
    return NextResponse.json(
      { error: `Сумма превышает остаток кассы точки (${formatMoney(result.freshBalance, locale)})` },
      { status: 400 }
    );
  }

  await chargeSelfServiceAdvanceToZones(
    point.tenantId,
    shiftPointId,
    advanceAmount + bonusAmount,
    operator.id
  ).catch((err) => console.error("chargeSelfServiceAdvanceToZones failed (advance-request)", err));

  notifyDailyCashLateSubmission(shiftPointId, point.tenantId, openShift.startAt).catch((err) =>
    console.error("daily cash late-submission notify failed", err)
  );

  const balance = await calcOperatorBalance(operator.id);
  return NextResponse.json({ ok: true, balance });
}
