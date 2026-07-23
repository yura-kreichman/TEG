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
import { chargeSelfServiceAdvanceToZones, getPointCashBalance } from "@/lib/zone-balance";
import { dispatchShiftCloseSummary } from "@/lib/summary-channels/dispatch";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { notifyDailyCashLateSubmission } from "@/lib/summary-channels/daily-cash-trigger";

class ShiftOverlapError extends Error {}

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

  if (advanceAmount > 0 || bonusAmount > 0) {
    // Аванс И премия, которые сотрудник вводит САМ, — физически из кассы
    // точки, обе ограничены её остатком, БЕЗ исключений (решение пользователя
    // 2026-07-15) — жёсткий кап даже с овердрафтом.
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
    // Вторая, независимая проверка — только для аванса: личный баланс "к
    // выдаче" + овердрафт (решение пользователя 2026-07-15) — обе проверки
    // должны пройти.
    const balance = await calcOperatorBalance(operator.id);
    // Аванс вводится в той же форме, что и сама смена — доступный баланс
    // должен уже учитывать начисление ЗА ЭТУ смену, иначе самый первый аванс
    // на самой первой смене оператора всегда бы блокировался.
    const rate = await getRateForDate(operator.id, startAt);
    const { accrued } = calcShiftAccrual(startAt, endAt, rate);
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

  // Авторитетная, атомарная проверка пересечения под локом по operatorId
  // (аудит 2026-07-25, финальный проход) — проверка выше (до этой точки) —
  // только быстрый оптимистичный отказ, не закрывает гонку сама по себе:
  // два почти одновременных ручных ввода смены (двойной клик, две вкладки)
  // могли оба пройти её на одном и том же устаревшем состоянии и оба
  // создать реально пересекающиеся смены.
  let shift;
  try {
    shift = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
      if (await hasOverlappingShift(operator.id, startAt, endAt, undefined, tx)) {
        throw new ShiftOverlapError();
      }
      return tx.shift.create({
        data: { tenantId: point.tenantId, operatorId: operator.id, pointId: point.id, startAt, endAt },
      });
    });
  } catch (err) {
    if (err instanceof ShiftOverlapError) {
      return NextResponse.json({ error: "Смена пересекается с другой вашей сменой" }, { status: 409 });
    }
    throw err;
  }

  // Авторитетная, атомарная проверка потолка под локом по pointId — см.
  // тот же паттерн и комментарий в /api/operator/work-time/check-out.
  // Проверка выше — только быстрый оптимистичный отказ, не закрывает гонку
  // сама по себе.
  if (advanceAmount + bonusAmount > 0) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${point.id}))`;
      const freshBalance = await getPointCashBalance(point.id);
      if (advanceAmount + bonusAmount > freshBalance) {
        return { ok: false as const, freshBalance };
      }
      if (advanceAmount > 0) {
        await tx.moneyOperation.create({
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
        await tx.moneyOperation.create({
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
      return { ok: true as const };
    });
    if (!result.ok) {
      const locale = await resolveLocale();
      return NextResponse.json(
        { error: `Сумма превышает остаток кассы точки (${formatMoney(result.freshBalance, locale)})` },
        { status: 400 }
      );
    }
    // Сразу разносим по зонам (запрос пользователя 2026-07-25), не дожидаясь
    // следующей инкассации — см. комментарий у chargeSelfServiceAdvanceToZones
    // в lib/zone-balance.ts. Вызов ПОСЛЕ обеих записей выше — важен порядок.
    // Не блокирует ответ при сбое — см. комментарий в check-out/route.ts.
    await chargeSelfServiceAdvanceToZones(point.tenantId, point.id, advanceAmount + bonusAmount, operator.id).catch(
      (err) => console.error("chargeSelfServiceAdvanceToZones failed (shifts)", err)
    );
  }

  const balance = await calcOperatorBalance(operator.id);
  const tenantForTz = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { timezone: true } });
  const noResultsToday = await hasNoResultsToday(point, operator, startAt, tenantForTz?.timezone ?? "UTC");

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
