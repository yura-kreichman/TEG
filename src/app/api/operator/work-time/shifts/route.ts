import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { requireOperator } from "@/lib/require-operator";
import {
  calcOperatorBalance,
  calcShiftAccrual,
  getRateForDate,
  hasNoResultsToday,
  resolveSelfServicePayout,
  hasOverlappingShift,
  listShiftDetails,
  listStandaloneMoneyOps,
  validateShift,
} from "@/lib/work-time";
import { chargeSelfServiceAdvanceToZones, getPointCashBalance } from "@/lib/zone-balance";
import { periodBoundsUtc } from "@/lib/business-day";
import { dispatchShiftCloseSummary, pointNameIfMany } from "@/lib/summary-channels/dispatch";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { notifyDailyCashLateSubmission, onShiftClosed } from "@/lib/summary-channels/daily-cash-trigger";
import { rememberShiftSummaryMessage } from "@/lib/summary-channels/resync";

class ShiftOverlapError extends Error {}

/**
 * Отказ денежной части — БРОСАЕТСЯ, а не возвращается (С49). Обычный возврат
 * из prisma.$transaction её коммитит: смена оставалась созданной без аванса и
 * премии, а повторить было нельзя — вторая попытка упиралась в пересечение.
 */
class CashOutRefused extends Error {
  constructor(
    public reason: "point" | "personal",
    public amount: number
  ) {
    super("cash out refused");
  }
}

/**
 * Денежная часть ручного ввода смены — аванс, премия и их разнесение по
 * зонам. Вынесено, чтобы вызываться ВНУТРИ той же транзакции, что создаёт
 * саму смену (С49): раньше это была отдельная транзакция после коммита
 * смены, и её отказ оставлял смену без денег, без возможности повторить.
 *
 * Отказы — броском CashOutRefused: обычный возврат из prisma.$transaction её
 * коммитит, то есть откатить уже созданную смену было бы нечем.
 */
async function writeShiftCashOut(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string;
    pointId: string;
    operator: { id: string; overdraftAllowed: boolean };
    shiftId: string;
    advanceAmount: number;
    bonusAmount: number;
    cashOutAmount: number;
    bonusIsAccrual: boolean;
  }
) {
  // С tx, а не мимо него: авторитетная проверка под локом обязана читать
  // данные ТОЙ ЖЕ транзакции, иначе лок защищает не то, что проверяется.
  const freshBalance = await getPointCashBalance(p.pointId, tx);
  // cashOutAmount > 0 — см. С11 в check-out: в режиме «Только начисление» из
  // кассы не уходит ничего, и без обёртки премия терялась при отрицательной
  // кассе точки.
  if (p.cashOutAmount > 0 && p.cashOutAmount > freshBalance) {
    throw new CashOutRefused("point", freshBalance);
  }
  if (p.advanceAmount > 0) {
    const freshOperatorBalance = await calcOperatorBalance(p.operator.id, undefined, tx);
    // БЕЗ прибавки accrued (С10): смена создана этой же транзакцией и уже
    // закрыта — её начисление внутри toPayOut.
    const projectedToPayOut = freshOperatorBalance.toPayOut;
    if (!p.operator.overdraftAllowed && p.advanceAmount > projectedToPayOut) {
      throw new CashOutRefused("personal", projectedToPayOut);
    }
    const advanceOp = await tx.moneyOperation.create({
      data: {
        tenantId: p.tenantId,
        pointId: p.pointId,
        type: "advance",
        amount: -p.advanceAmount,
        performedByOperatorId: p.operator.id,
        beneficiaryOperatorId: p.operator.id,
        shiftId: p.shiftId,
      },
    });
    // Своим вызовом на КАЖДУЮ выплату (правка 2026-09-04): строки разнесения
    // привязываются к породившей их операции, и отмена снимает ровно их.
    await chargeSelfServiceAdvanceToZones(
      p.tenantId,
      p.pointId,
      p.advanceAmount,
      p.operator.id,
      tx,
      advanceOp.id
    );
  }
  if (p.bonusAmount > 0) {
    const bonusOp = await tx.moneyOperation.create({
      data: {
        tenantId: p.tenantId,
        pointId: p.pointId,
        // Начисленная премия — положительной суммой и другим типом: кассу не
        // трогает, увеличивает долг компании (см. MoneyOperation в схеме).
        type: p.bonusIsAccrual ? "bonus_accrual" : "bonus_payout",
        amount: p.bonusIsAccrual ? p.bonusAmount : -p.bonusAmount,
        performedByOperatorId: p.operator.id,
        beneficiaryOperatorId: p.operator.id,
        shiftId: p.shiftId,
      },
    });
    // Начисленная премия из кассы не уходила — разносить нечего.
    if (!p.bonusIsAccrual) {
      await chargeSelfServiceAdvanceToZones(
        p.tenantId,
        p.pointId,
        p.bonusAmount,
        p.operator.id,
        tx,
        bonusOp.id
      );
    }
  }
  // Разнесение идёт той же транзакцией и под тем же локом (С19) — теперь на
  // месте создания каждой выплаты, выше, а не одной суммой cashOutAmount.
}

export async function GET(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  // Границы недели/месяца — в календаре тенанта (см. periodBoundsUtc).
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.operator.tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  const period = fromParam && toParam ? periodBoundsUtc(fromParam, toParam, tenant?.timezone ?? "UTC", tenant?.businessDayBoundary ?? "00:00") : undefined;

  const shifts = await listShiftDetails(ctx.operator.id, period);
  const standaloneMoneyOps = await listStandaloneMoneyOps(ctx.operator.id, period);

  // Отметка "правил Владелец" — та же, что у него самого в карточке
  // сотрудника (правка владельца 2026-08-17): сотрудник должен видеть, что
  // его смену или аванс поправили, а не гадать, почему изменились цифры.
  const [editedShiftIds, editedOpIds] = await Promise.all([
    prisma.correctionLog
      .findMany({ where: { entityType: "Shift", entityId: { in: shifts.map((sh) => sh.id) } }, select: { entityId: true } })
      .then((rows) => new Set(rows.map((r) => r.entityId))),
    prisma.correctionLog
      .findMany({
        where: { entityType: "MoneyOperation", entityId: { in: standaloneMoneyOps.map((op) => op.id) } },
        select: { entityId: true },
      })
      .then((rows) => new Set(rows.map((r) => r.entityId))),
  ]);

  return NextResponse.json({
    shifts: shifts.map((sh) => ({ ...sh, edited: editedShiftIds.has(sh.id) })),
    standaloneMoneyOps: standaloneMoneyOps.map((op) => ({ ...op, edited: editedOpIds.has(op.id) })),
  });
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

  // Право самообслуживания — то же самое, что в check-out (запрос
  // пользователя 2026-08-12): серверная проверка, не только скрытие полей.
  const payoutTenant = await prisma.tenant.findUnique({
    where: { id: point.tenantId },
    select: { selfServicePayoutMode: true },
  });
  const payoutRights = resolveSelfServicePayout(
    payoutTenant?.selfServicePayoutMode,
    operator.selfServicePayoutAllowed
  );
  if (advanceAmount > 0 && !payoutRights.canAdvance) {
    return NextResponse.json({ error: "Аванс сейчас недоступен — обратитесь к владельцу" }, { status: 403 });
  }
  if (bonusAmount > 0 && !payoutRights.canBonusCash && !payoutRights.canBonusAccrual) {
    return NextResponse.json({ error: "Премия сейчас недоступна — обратитесь к владельцу" }, { status: 403 });
  }
  const bonusIsAccrual = payoutRights.canBonusAccrual;
  const cashOutAmount = advanceAmount + (bonusIsAccrual ? 0 : bonusAmount);

  if (await hasOverlappingShift(operator.id, startAt, endAt)) {
    return NextResponse.json({ error: "Смена пересекается с другой вашей сменой" }, { status: 409 });
  }

  if (cashOutAmount > 0) {
    // Аванс И премия, которые сотрудник вводит САМ, — физически из кассы
    // точки, обе ограничены её остатком, БЕЗ исключений (решение пользователя
    // 2026-07-15) — жёсткий кап даже с овердрафтом. Начисленная премия
    // (режим "accrual") сюда не входит: из кассы по ней ничего не уходит.
    const pointBalance = await getPointCashBalance(point.id);
    if (cashOutAmount > pointBalance) {
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
  // СМЕНА И ДЕНЬГИ — ОДНОЙ ТРАНЗАКЦИЕЙ (генеральная проверка финансов, С49).
  // Раньше их было две: смена создавалась первой и коммитилась, а при отказе
  // денежной (превышен остаток кассы или личный баланс) оставалась в базе БЕЗ
  // аванса и премии. Повторить ввод было нельзя — вторая попытка упиралась в
  // «Смена пересекается с другой вашей сменой», и касса с «к выдаче»
  // расходились навсегда. Ровно тот же сбой, что чинили в check-out.
  //
  // Порядок локов — pointId, затем operatorId: тот же во всём проекте, чтобы
  // ни одна пара транзакций не встретилась в обратном.
  let shift;
  try {
    shift = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${point.id}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
      // Авторитетная проверка пересечения под локом (аудит 2026-07-25):
      // оптимистичная выше гонку не закрывает — два почти одновременных ввода
      // читали одно устаревшее состояние и оба создавали пересекающиеся смены.
      if (await hasOverlappingShift(operator.id, startAt, endAt, undefined, tx)) {
        throw new ShiftOverlapError();
      }
      const created = await tx.shift.create({
        data: { tenantId: point.tenantId, operatorId: operator.id, pointId: point.id, startAt, endAt },
      });

      if (advanceAmount + bonusAmount > 0) {
        await writeShiftCashOut(tx, {
          tenantId: point.tenantId,
          pointId: point.id,
          operator,
          shiftId: created.id,
          advanceAmount,
          bonusAmount,
          cashOutAmount,
          bonusIsAccrual,
        });
      }
      return created;
    });
  } catch (err) {
    if (err instanceof ShiftOverlapError) {
      return NextResponse.json({ error: "Смена пересекается с другой вашей сменой" }, { status: 409 });
    }
    // Отказ денежной части — броском, чтобы транзакция откатила и смену.
    if (err instanceof CashOutRefused) {
      const locale = await resolveLocale();
      const error =
        err.reason === "point"
          ? `Сумма превышает остаток кассы точки (${formatMoney(err.amount, locale)})`
          : `Аванс превышает доступный баланс к выдаче (${formatMoney(err.amount, locale)})`;
      return NextResponse.json({ error }, { status: 400 });
    }
    throw err;
  }


  const balance = await calcOperatorBalance(operator.id);
  const tenantForTz = await prisma.tenant.findUnique({
    where: { id: point.tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  const noResultsToday = await hasNoResultsToday(
    point,
    operator,
    startAt,
    tenantForTz?.timezone ?? "UTC",
    tenantForTz?.businessDayBoundary ?? "06:00"
  );

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
        pointName: await pointNameIfMany(point.tenantId, point.name),
        operatorName: operator.name,
        operatorColorTag: operator.colorTag,
        startAt,
        endAt,
        minutes,
        rate,
        accrued,
        advanceAmount,
        bonusAmount,
        bonusIsAccrual,
        toPayOut: balance.toPayOut,
      },
      shiftCloseSettings
    )
      // id сообщения — чтобы позднейшая правка смены или её аванса/премии
      // переписала эту сводку, а не оставила её врать в чате (требование
      // владельца 2026-08-16, см. lib/summary-channels/resync.ts).
      .then((results) => rememberShiftSummaryMessage(shift.id, results))
      .catch((err) => console.error("shift close summary dispatch failed", err));
  }

  // Смена с авансом/премией меняет остаток кассы точки — если сегодняшняя
  // "Касса за день" уже отправлена, это досдача. Начисленная премия кассу не
  // меняет, поэтому и досдачей не является — отсюда cashOutAmount.
  if (cashOutAmount > 0) {
    notifyDailyCashLateSubmission(point.id, point.tenantId, startAt).catch((err) =>
      console.error("daily cash late-submission notify failed", err)
    );
  }

  // В РУЧНОМ режиме смена вводится целиком и сразу закрытой — отдельного
  // "ухода" не существует, поэтому именно это создание и есть то самое
  // закрытие рабочего времени, по которому теперь уходит "Касса за день"
  // (решение пользователя 2026-08-06).
  //
  // РЕАЛЬНЫЙ БАГ, найден пользователем в тот же день: onShiftClosed висел
  // только на check-out, то есть на авто-режиме. Женя сдал зоны, потом ввёл
  // смену руками — и сводка не пришла ВООБЩЕ: на момент сдачи смены за день
  // ещё не было (значит правило откатывалось к полному покрытию зон, а
  // "Виртуалка" пустая и не сдавалась), а создание смены никакой первой
  // отправки не запускало — notifyDailyCashLateSubmission выше сознательно
  // молчит, когда отправлять ещё нечего.
  onShiftClosed(point.id, point.tenantId, startAt).catch((err) =>
    console.error("daily cash on-shift-closed failed", err)
  );

  const shiftRow = { id: shift.id, startAt, endAt, minutes, rate, accrued, advanceAmount, bonusAmount };
  return NextResponse.json({ shift: shiftRow, warnings, noResultsToday, balance });
}
