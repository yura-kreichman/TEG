import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  calcOperatorBalance,
  calcShiftAccrual,
  getOpenShift,
  getRateForDate,
  hasNoResultsToday,
  resolveSelfServicePayout,
  validateShift,
} from "@/lib/work-time";
import { chargeSelfServiceAdvanceToZones, getPointCashBalance } from "@/lib/zone-balance";
import { dispatchShiftCloseSummary, pointNameIfMany } from "@/lib/summary-channels/dispatch";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { notifyDailyCashLateSubmission, onShiftClosed } from "@/lib/summary-channels/daily-cash-trigger";
import { rememberShiftSummaryMessage } from "@/lib/summary-channels/resync";
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
  // Касса и зонное разнесение авансов/премий должны идти по ТОЙ точке, где
  // реально шла смена (openShift.pointId), а не по текущей точке устройства
  // (point.id/ctx.point) — на роуминг-устройстве (PointDevice.roaming) их
  // может отличать /api/operator/switch-point, вызванный ПОСЛЕ check-in, но
  // ДО check-out (реальный баг, найден аудитом 2026-07-24: см. комментарий
  // у поля Shift.pointId в prisma/schema.prisma — "нужна, чтобы знать, из
  // кассы какой точки списывать" — код это нарушал, списывая с кассы точки
  // устройства, а не точки смены).
  const shiftPointId = openShift.pointId;

  const body = await request.json().catch(() => ({}));
  const advanceAmount = Math.abs(Number(body.advanceAmount) || 0);
  const bonusAmount = Math.abs(Number(body.bonusAmount) || 0);

  // Право вносить аванс/премию самому (запрос пользователя 2026-08-12) —
  // тенантный режим И персональный тумблер сотрудника. Проверка на сервере,
  // а не только скрытие полей в PWA: /operator — публично доступный URL со
  // входом по ПИН, форму можно отправить и мимо интерфейса. Тот же принцип,
  // что у expensesEnabled в /api/operator/zone-expense-events.
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
  // В режиме "accrual" та же сумма премии из формы записывается не выдачей, а
  // начислением: тип операции и знак решает сервер, PWA про это не знает и
  // шлёт одно и то же поле bonusAmount (см. Tenant.selfServicePayoutMode).
  const bonusIsAccrual = payoutRights.canBonusAccrual;
  // Из кассы точки физически уходит только то, что выдано наличными —
  // начисленная премия в кассовых проверках ниже не участвует вовсе.
  const cashOutAmount = advanceAmount + (bonusIsAccrual ? 0 : bonusAmount);

  const startAt = openShift.startAt;
  const endAt = new Date();
  if (endAt <= startAt) {
    return NextResponse.json({ error: "Некорректное время окончания" }, { status: 400 });
  }

  const rate = await getRateForDate(operator.id, startAt);
  const { minutes, accrued } = calcShiftAccrual(startAt, endAt, rate);

  if (cashOutAmount > 0) {
    // Аванс И премия, которые сотрудник вводит САМ (без владельца рядом), —
    // физически берутся из кассы точки, обе ограничены её остатком, БЕЗ
    // исключений (решение пользователя 2026-07-15) — этот кап всегда жёсткий,
    // даже с овердрафтом. У владельца наоборот: деньги не из кассы точки,
    // проверка по личному балансу сотрудника + овердрафт — см.
    // /api/operators/[id]/work-time/advance и .../bonus.
    const pointBalance = await getPointCashBalance(shiftPointId);
    if (cashOutAmount > pointBalance) {
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
  // Закрытие смены и её деньги — ОДНА транзакция (генеральная проверка
  // финансов 2026-09-02, С19). Раньше смена закрывалась отдельным updateMany,
  // а деньги писались независимой транзакцией ниже: штатный отказ внутри неё
  // (превышен остаток кассы или личный баланс) оставлял смену закрытой БЕЗ
  // денежной операции, а повторить было нельзя — второй заход упирался в 409.
  // Касса точки и «к выдаче» сотрудника оставались завышенными навсегда.
  const closed = await prisma.$transaction(async (tx) => {
    // Лок точки берём ДО обновления строки смены и держим до конца — тем же
    // порядком (pointId, затем operatorId), что и остальной денежный код.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shiftPointId}))`;
    // Атомарный "compare-and-swap" сохранён: WHERE isOpen:true по-прежнему
    // отсекает параллельный check-out (реальный баг 2026-07-18 — два запроса
    // в 12 мс друг от друга задваивали премию).
    const closeResult = await tx.shift.updateMany({
      where: { id: openShift.id, isOpen: true },
      data: { endAt, isOpen: false },
    });
    if (closeResult.count === 0) return { ok: false as const, reason: "closed" as const };

    if (advanceAmount + bonusAmount > 0) {
      const freshBalance = await getPointCashBalance(shiftPointId, tx);
      // Условие cashOutAmount > 0 обязательно (С11): в режиме «Только
      // начисление» из кассы не уходит ничего, и без него проверка
      // вырождалась в «ноль больше остатка» — при отрицательной кассе точки
      // (её уводят расходы, они остаток не проверяют) начисленная премия
      // просто терялась. Вместе с ней пропадала сводка закрытия смены, а
      // повторить было нельзя: смена уже закрыта, второй заход даёт 409.
      // Оптимистичная проверка выше такую обёртку имеет с самого начала.
      if (cashOutAmount > 0 && cashOutAmount > freshBalance) {
        return { ok: false as const, reason: "point" as const, freshBalance };
      }
      if (advanceAmount > 0) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
        const freshOperatorBalance = await calcOperatorBalance(operator.id, undefined, tx);
        // БЕЗ прибавки accrued (генеральная проверка финансов 2026-09-02, С10).
        // Оптимистичная проверка выше читает баланс, пока смена ещё открыта, и
        // там прибавка обязательна: calcOperatorBalance считает только ЗАКРЫТЫЕ
        // смены. Здесь смена уже закрыта этой же транзакцией, её начисление
        // внутри toPayOut — прибавка учитывала его дважды и делала
        // авторитетную проверку мягче оптимистичной ровно на смену зарплаты.
        // Эталон — work-time/shifts/[id]/route.ts.
        const projectedToPayOut = freshOperatorBalance.toPayOut;
        if (!operator.overdraftAllowed && advanceAmount > projectedToPayOut) {
          return { ok: false as const, reason: "personal" as const, projectedToPayOut };
        }
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
            // Начисленная премия хранится ПОЛОЖИТЕЛЬНОЙ: она не уменьшает
            // кассу, а увеличивает долг компании (см. MoneyOperation в
            // schema.prisma). Выданная — отрицательной, как и раньше.
            type: bonusIsAccrual ? "bonus_accrual" : "bonus_payout",
            amount: bonusIsAccrual ? bonusAmount : -bonusAmount,
            performedByOperatorId: operator.id,
            beneficiaryOperatorId: operator.id,
            shiftId: openShift.id,
          },
        });
      }
      // Разнесение по зонам — ТОЙ ЖЕ транзакцией и под тем же локом. Раньше
      // функция открывала свою, и в зазоре между коммитами инкассация успевала
      // списать те же деньги через poolDeficit, а разнесение списывало их
      // второй раз. cashOutAmount, не advance+bonus: начисленная премия из
      // кассы точки не уходила, разносить нечего.
      if (cashOutAmount > 0) {
        await chargeSelfServiceAdvanceToZones(point.tenantId, shiftPointId, cashOutAmount, operator.id, tx);
      }
    }
    return { ok: true as const };
  });

  if (!closed.ok) {
    if (closed.reason === "closed") {
      return NextResponse.json({ error: "Смена уже закрыта" }, { status: 409 });
    }
    const locale = await resolveLocale();
    const error =
      closed.reason === "point"
        ? `Сумма превышает остаток кассы точки (${formatMoney(closed.freshBalance, locale)})`
        : `Аванс превышает доступный баланс к выдаче (${formatMoney(closed.projectedToPayOut, locale)})`;
    return NextResponse.json({ error }, { status: 400 });
  }


  const balance = await calcOperatorBalance(operator.id);
  const tenantForTz = await prisma.tenant.findUnique({
    where: { id: point.tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  const noResultsToday = await hasNoResultsToday(
    { id: shiftPointId },
    operator,
    endAt,
    tenantForTz?.timezone ?? "UTC",
    tenantForTz?.businessDayBoundary ?? "06:00"
  );

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
      // См. тот же вызов в POST .../work-time/shifts: сохраняем id сводки для
      // будущих правок (lib/summary-channels/resync.ts).
      .then((results) => rememberShiftSummaryMessage(openShift.id, results))
      .catch((err) => console.error("shift close summary dispatch failed", err));
  }

  // Смена с авансом/премией меняет остаток кассы точки — если сегодняшняя
  // "Касса за день" уже отправлена, это досдача (см. POST .../work-time/shifts).
  if (cashOutAmount > 0) {
    notifyDailyCashLateSubmission(shiftPointId, point.tenantId, startAt).catch((err) =>
      console.error("daily cash late-submission notify failed", err)
    );
  }

  // Закрытие смены само по себе не меняет кассу, но может быть последним,
  // чего не хватало для ПЕРВОЙ отправки (запрос пользователя 2026-07-14: все
  // зоны уже отчитались, а этот оператор был последним с открытой сменой) —
  // всегда, не только при авансе/премии. startAt, не endAt — чтобы совпадать
  // с business-day, к которому notifyDailyCashLateSubmission выше уже
  // отнёс эту же смену.
  onShiftClosed(shiftPointId, point.tenantId, startAt).catch((err) =>
    console.error("daily cash on-shift-closed notify failed", err)
  );

  const shiftRow = { id: openShift.id, startAt, endAt, minutes, rate, accrued, advanceAmount, bonusAmount };
  return NextResponse.json({ shift: shiftRow, warnings, noResultsToday, balance });
}
