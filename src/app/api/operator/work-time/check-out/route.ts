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
  // Атомарный "compare-and-swap" вместо обычного update (реальный баг,
  // найден пользователем 2026-07-18 на проде: два почти одновременных
  // запроса check-out — 12мс друг от друга — оба видели смену открытой и
  // ОБА создали премию/аванс, задвоив реальные деньги оператора). WHERE
  // isOpen:true гарантирует, что если смену уже закрыл параллельный запрос,
  // updateMany затронет 0 строк — PostgreSQL сериализует конкурентные
  // UPDATE на одну и ту же строку на уровне блокировки, второй запрос ждёт
  // коммита первого и видит уже актуальный isOpen:false.
  const closeResult = await prisma.shift.updateMany({
    where: { id: openShift.id, isOpen: true },
    data: { endAt, isOpen: false },
  });
  if (closeResult.count === 0) {
    return NextResponse.json({ error: "Смена уже закрыта" }, { status: 409 });
  }

  // Авторитетная, атомарная проверка потолка — та же блокировка по pointId,
  // что у chargeSelfServiceAdvanceToZones/settleOutstandingCollectionAdvance
  // (lib/zone-balance.ts). Проверка выше (до закрытия смены) — только
  // быстрый оптимистичный отказ для типового случая; она сама по себе не
  // закрывает гонку (найдено аудитом 2026-07-25: два почти одновременных
  // check-out на разных операторов одной точки могли оба прочитать один и
  // тот же pointBalance ДО того, как другой успевал списать свой аванс, и
  // оба пройти проверку, вместе превысив кассу). Здесь — авторитетный повтор
  // ровно перед самой записью, под локом.
  if (advanceAmount + bonusAmount > 0) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shiftPointId}))`;
      const freshBalance = await getPointCashBalance(shiftPointId);
      if (cashOutAmount > freshBalance) {
        return { ok: false as const, reason: "point" as const, freshBalance };
      }
      if (advanceAmount > 0) {
        // Личный баланс "к выдаче" (аудит 2026-07-31) — тот же авторитетный
        // повтор под локом, что и у кассы точки выше, раньше отсутствовал:
        // см. подробный комментарий в /api/operator/work-time/shifts (тот же
        // класс гонки с ручным авансом от Владельца). Лок по operatorId —
        // ПОСЛЕ pointId, тем же порядком, что и там.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
        const freshOperatorBalance = await calcOperatorBalance(operator.id, undefined, tx);
        const projectedToPayOut = freshOperatorBalance.toPayOut + accrued;
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
      return { ok: true as const };
    });
    if (!result.ok) {
      const locale = await resolveLocale();
      const error =
        result.reason === "point"
          ? `Сумма превышает остаток кассы точки (${formatMoney(result.freshBalance, locale)})`
          : `Аванс превышает доступный баланс к выдаче (${formatMoney(result.projectedToPayOut, locale)})`;
      return NextResponse.json({ error }, { status: 400 });
    }
    // Сразу разносим по зонам (запрос пользователя 2026-07-25), не дожидаясь
    // следующей инкассации — см. комментарий у chargeSelfServiceAdvanceToZones
    // в lib/zone-balance.ts. Вызов ПОСЛЕ обеих записей выше — важен порядок.
    // Не блокирует ответ при сбое (см. .catch ниже) — деньги уже честно
    // списаны из личного баланса сотрудника, при ошибке зонного разнесения
    // остаётся старый механизм-фолбэк (getPointPoolDeficit) на следующей
    // инкассации.
    // cashOutAmount, не advance+bonus: начисленная премия из кассы точки не
    // уходила, разносить по зонам нечего.
    if (cashOutAmount > 0) {
      await chargeSelfServiceAdvanceToZones(point.tenantId, shiftPointId, cashOutAmount, operator.id).catch((err) =>
        console.error("chargeSelfServiceAdvanceToZones failed (check-out)", err)
      );
    }
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
