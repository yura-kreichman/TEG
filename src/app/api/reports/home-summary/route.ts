import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantDayContext } from "@/lib/tenant-day";
import { requireOwner } from "@/lib/require-owner";
import { calcSessions, calcZoneRevenue, isLaunchesZone, isStaysZone, isTicketsZone } from "@/lib/results-calc";
import { getCountersBalanceBySubmission } from "@/lib/abonement";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { aggregateTicketOrdersBySubmission } from "@/lib/tickets";
import { businessDayOf, dayBoundsUtc } from "@/lib/business-day";
import { PAYMENT_SPLIT_METHOD } from "@/lib/payment-split";

interface WindowSummary {
  revenue: number;
  cash: number;
  mobile: number;
  profit: number;
  submissionsCount: number;
  difference: number;
  expenses: number;
  returnsCount: number;
}


// Календарный день ПО МЕСТУ (часовой пояс тенанта), не сырой UTC сервера
// (аудит 2026-07-24: реальный баг — сдача около полуночи по месту могла
// попасть на карточку "23 июля" здесь и на "24 июля" в /api/reports/money за
// тот же день, см. комментарий у dayBoundsUtc в lib/business-day.ts).
function dayBoundsFor(d: Date, timezone: string, boundary: string): { start: Date; end: Date } {
  const { year, month, day } = businessDayOf(d, timezone, boundary);
  return dayBoundsUtc(year, month, day, timezone, boundary);
}

// dayStart — местная полночь как момент UTC (например 21:00 UTC для
// тенанта +3) — .toISOString().slice(0,10) читал бы UTC-дату этого момента,
// т.е. предыдущее число (тот же баг, что и раньше сами границы). Нужна
// именно местная календарная дата.
function formatLocalDateKey(d: Date, timezone: string, boundary: string): string {
  const { year, month, day } = businessDayOf(d, timezone, boundary);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Считает сводку за конкретное окно [dayStart, dayEnd) для ОДНОЙ точки —
// используется и для одной точки, и как строительный блок для "Все точки"
// (там каждая точка берёт СВОЁ собственное окно, см. GET ниже).
async function computeWindowSummary(
  tenantId: string,
  pointId: string,
  dayStart: Date,
  dayEnd: Date
): Promise<WindowSummary> {
  const submissions = await prisma.resultsSubmission.findMany({
    where: { tenantId, pointId, submittedAt: { gte: dayStart, lt: dayEnd } },
    include: {
      zoneSubmissions: {
        include: { zone: { include: { tariffs: true } }, assetReadings: true },
      },
    },
  });

  // Разница по зоне сравнивает кассу с расчётной выручкой — только "counters"/
  // "launches" её вообще имеют (docs/spec/01-counters.md, "Режим учёта зоны").
  // Сеансы в "counters" считаются от предыдущего показания по всей истории
  // актива, не только за этот день — тот же приём, что в дневном отчёте.
  const assetIds = new Set<string>();
  for (const s of submissions) {
    for (const zs of s.zoneSubmissions) {
      if (zs.zone.accountingMode !== "counters") continue;
      for (const r of zs.assetReadings) assetIds.add(r.assetId);
    }
  }
  const allReadings = assetIds.size
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: [...assetIds] } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const initialByKey = await getInitialReadingsMap([...assetIds]);
  const runningPrevious = new Map<string, number>(initialByKey);
  const sessionsById = new Map<string, number>();
  for (const r of allReadings) {
    const key = `${r.assetId}:${r.tariffId}`;
    const previous = runningPrevious.get(key) ?? 0;
    sessionsById.set(r.id, calcSessions(r.reading, previous));
    runningPrevious.set(key, r.reading);
  }

  // "Прибывания" и "Пуски" (после перехода на тапы, assetReadings пустой) не
  // пишут AssetReading — их расчётная выручка живёт в Launch, привязанном к
  // zoneSubmissionId сервером при сдаче итогов (тот же разрыв, что был найден
  // и исправлен в reports.ts computeZoneSubmissionRevenues, запрос
  // пользователя 2026-07-17: "в Отчётах не отображается корректно"; здесь —
  // тот же класс бага, просто в сводке "Последние итоги" на главной).
  const liveZoneSubmissionIds = submissions
    .flatMap((s) => s.zoneSubmissions)
    .filter((zs) => isStaysZone(zs.zone) || (isLaunchesZone(zs.zone) && zs.assetReadings.length === 0))
    .map((zs) => zs.id);
  const liveLaunches = liveZoneSubmissionIds.length
    ? await prisma.launch.findMany({
        where: { zoneSubmissionId: { in: liveZoneSubmissionIds }, voidedAt: null },
        select: { id: true, zoneSubmissionId: true, amount: true, paymentMethod: true },
      })
    : [];
  const liveRevenueBySubmission = new Map<string, number>();
  // Абонемент — касса точки эту сумму уже получила раньше, при пополнении,
  // не сейчас — вычитается из calculatedRevenue при расчёте разницы ниже
  // (реальный баг, найден пользователем 2026-07-18: без вычитания разница
  // ложно показывала недостачу ровно на сумму пусков, оплаченных
  // абонементом).
  const liveAbonementBySubmission = new Map<string, number>();
  const liveSplitLaunchIds: string[] = [];
  for (const l of liveLaunches) {
    if (!l.zoneSubmissionId) continue;
    const amount = Number(l.amount ?? 0);
    liveRevenueBySubmission.set(l.zoneSubmissionId, (liveRevenueBySubmission.get(l.zoneSubmissionId) ?? 0) + amount);
    if (l.paymentMethod === "abonement") {
      liveAbonementBySubmission.set(
        l.zoneSubmissionId,
        (liveAbonementBySubmission.get(l.zoneSubmissionId) ?? 0) + amount
      );
    } else if (l.paymentMethod === PAYMENT_SPLIT_METHOD) {
      liveSplitLaunchIds.push(l.id);
    }
  }
  // Разбивка оплаты (аудит 2026-07-26) — доля "Баланс" сплит-пуска тоже уже
  // списана и должна вычитаться из Разницы, тот же класс бага, что и у
  // обычного paymentMethod="abonement" выше.
  if (liveSplitLaunchIds.length > 0) {
    const legs = await prisma.launchPaymentLeg.findMany({
      where: { launchId: { in: liveSplitLaunchIds }, method: "abonement" },
      select: { launchId: true, amount: true },
    });
    const launchToSubmission = new Map(liveLaunches.map((l) => [l.id, l.zoneSubmissionId]));
    for (const leg of legs) {
      const zoneSubmissionId = launchToSubmission.get(leg.launchId);
      if (!zoneSubmissionId) continue;
      liveAbonementBySubmission.set(zoneSubmissionId, (liveAbonementBySubmission.get(zoneSubmissionId) ?? 0) + Number(leg.amount));
    }
  }

  // Билеты (docs/spec/10-tickets.md, "Отчёты") — тот же класс бага, что у
  // Прибываний/Пусков выше, но для "Разницы" в сводке "Последние итоги":
  // без своей ветки zone.tariffs пуст, calcZoneRevenue([], ...) даёт 0, и
  // "разница" ложно раздувалась бы на всю кассу зоны. Заказы не привязаны к
  // zoneSubmissionId — окно восстанавливается по всей истории сдач зоны, тот
  // же приём, что в lib/reports.ts computeZoneSubmissionRevenues.
  const ticketZoneSubmissions = submissions.flatMap((s) => s.zoneSubmissions).filter((zs) => isTicketsZone(zs.zone));
  const ticketZoneIds = [...new Set(ticketZoneSubmissions.map((zs) => zs.zoneId))];
  const ticketBoundariesByZone = new Map<string, Date[]>();
  if (ticketZoneIds.length) {
    // Граница сверху — см. lib/reports.ts, тот же приём.
    const latestTicketSubmission = new Date(
      Math.max(...ticketZoneSubmissions.map((zs) => zs.createdAt.getTime()))
    );
    const allTicketZoneSubmissions = await prisma.zoneSubmission.findMany({
      where: { zoneId: { in: ticketZoneIds }, createdAt: { lte: latestTicketSubmission } },
      orderBy: { createdAt: "asc" },
      select: { zoneId: true, createdAt: true },
    });
    for (const row of allTicketZoneSubmissions) {
      const list = ticketBoundariesByZone.get(row.zoneId) ?? [];
      list.push(row.createdAt);
      ticketBoundariesByZone.set(row.zoneId, list);
    }
  }
  // Оплата балансом по ручным "Счётчикам" (2026-08-13, см.
  // countersPaidFromBalance) — тот же приём восстановления окна по всей
  // истории сдач зоны, что у Билетов выше: списания "revenue_abonement" не
  // привязаны к zoneSubmissionId, окно = (предыдущая сдача, эта сдача].
  const counterZoneSubmissions = submissions
    .flatMap((s) => s.zoneSubmissions)
    .filter((zs) => zs.zone.accountingMode === "counters");
  const counterZoneIds = [...new Set(counterZoneSubmissions.map((zs) => zs.zoneId))];
  const balanceBySubmission = new Map<string, number>();
  if (counterZoneIds.length) {
    const chain = await prisma.zoneSubmission.findMany({
      where: { zoneId: { in: counterZoneIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, zoneId: true, createdAt: true },
    });
    const previousById = new Map<string, Date | null>();
    const lastSeenByZone = new Map<string, Date>();
    for (const row of chain) {
      previousById.set(row.id, lastSeenByZone.get(row.zoneId) ?? null);
      lastSeenByZone.set(row.zoneId, row.createdAt);
    }
    // Один запрос на все сдачи дня, не по запросу на каждую — см. тот же
    // разбор в lib/reports.ts.
    const spendBySubmission = await getCountersBalanceBySubmission(
      counterZoneSubmissions.map((zs) => ({
        id: zs.id,
        zoneId: zs.zoneId,
        createdAt: zs.createdAt,
        since: previousById.get(zs.id) ?? null,
      })),
      new Map(counterZoneSubmissions.map((zs) => [zs.zoneId, zs.zone]))
    );
    for (const [id, spend] of spendBySubmission) balanceBySubmission.set(id, spend);
  }

  const ticketRevenueBySubmission = new Map<string, { totalAmount: number; abonementAmount: number }>();
  // Одним чтением на все сдачи дня (аудит 2026-08-14).
  const ticketAggregates = await aggregateTicketOrdersBySubmission(
    ticketZoneSubmissions.map((zs) => {
      const boundaries = ticketBoundariesByZone.get(zs.zoneId) ?? [];
      const idx = boundaries.findIndex((d) => d.getTime() === zs.createdAt.getTime());
      return { id: zs.id, zoneId: zs.zoneId, since: idx > 0 ? boundaries[idx - 1] : null, until: zs.createdAt };
    })
  );
  for (const [id, agg] of ticketAggregates) {
    ticketRevenueBySubmission.set(id, { totalAmount: agg.totalAmount, abonementAmount: agg.abonementAmount });
  }

  // Расходы, закрытые каждой сдачей (решение владельца 2026-08-16): сотрудник
  // вводит в кассу ОСТАТОК после трат, поэтому для сверки со счётчиками их
  // возвращают обратно в Разницу. Тот же расчёт, что в lib/reports.ts (экран
  // "Деньги") и api/reports/counters/day ("Итоги дня") — эта карточка была
  // единственным местом, где прибавку забыли, и Главная показывала недостачу
  // ровно на сумму расходов там, где остальные экраны показывали ноль
  // (найдено 2026-08-23 при разборе вопроса клиента).
  const submissionExpenseOps = await prisma.moneyOperation.findMany({
    where: {
      type: "expense",
      resultsSubmissionId: { in: submissions.map((s) => s.id) },
    },
    select: { zoneId: true, amount: true, resultsSubmissionId: true },
  });
  const expensesByZoneSubmission = new Map<string, number>();
  for (const op of submissionExpenseOps) {
    const key = `${op.resultsSubmissionId}:${op.zoneId}`;
    expensesByZoneSubmission.set(key, (expensesByZoneSubmission.get(key) ?? 0) + Math.abs(Number(op.amount)));
  }

  let totalDifference = 0;
  // Тесты/возвраты за день — сумма по всем сдачам (запрос пользователя
  // 2026-07-18: "в обоих должны быть видны Тесты/возвраты"), не только у
  // "counters" — поле общее для всех режимов, кроме "Только касса".
  let totalReturns = 0;
  for (const s of submissions) {
    for (const zs of s.zoneSubmissions) {
      if (zs.zone.accountingMode === "cash_only") continue;
      totalReturns += zs.returnsCount;
      const actualCash = Number(zs.cashAmount) + Number(zs.mobileAmount);
      const expensesInSubmission =
        expensesByZoneSubmission.get(`${zs.resultsSubmissionId}:${zs.zoneId}`) ?? 0;

      if (isStaysZone(zs.zone) || (isLaunchesZone(zs.zone) && zs.assetReadings.length === 0)) {
        const calculatedRevenue = liveRevenueBySubmission.get(zs.id) ?? 0;
        const abonementAmount = liveAbonementBySubmission.get(zs.id) ?? 0;
        totalDifference += actualCash + expensesInSubmission + abonementAmount - calculatedRevenue;
        continue;
      }

      if (isTicketsZone(zs.zone)) {
        const ticketRevenue = ticketRevenueBySubmission.get(zs.id);
        const calculatedRevenue = ticketRevenue?.totalAmount ?? 0;
        const abonementAmount = ticketRevenue?.abonementAmount ?? 0;
        totalDifference += actualCash + expensesInSubmission + abonementAmount - calculatedRevenue;
        continue;
      }

      const isLaunches = zs.zone.accountingMode === "launches";
      const tariffCalc = zs.zone.tariffs.map((tariff) => ({
        tariffId: tariff.id,
        price: Number(tariff.price),
        sessions: zs.assetReadings
          .filter((r) => r.tariffId === tariff.id)
          .reduce((sum, r) => sum + (isLaunches ? r.reading : (sessionsById.get(r.id) ?? 0)), 0),
      }));
      const calculatedRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);
      // Источник уже выбран по типу зоны выше (см. balanceBySubmission).
      totalDifference +=
        actualCash + expensesInSubmission - (calculatedRevenue - (balanceBySubmission.get(zs.id) ?? 0));
    }
  }

  const operations = await prisma.moneyOperation.findMany({
    where: {
      tenantId,
      occurredAt: { gte: dayStart, lt: dayEnd },
      OR: [{ zone: { pointId } }, { pointId }],
    },
  });
  let revenue = 0;
  let expense = 0;
  // Зарплаты (пересмотрено 2026-07-25 — см. полный разбор в
  // reports/money/route.ts): авансы/премии — реальные деньги, физически
  // покинувшие кассу, значит настоящий расход бизнеса — теперь тоже
  // вычитаются из Прибыли здесь, иначе та же "Прибыль" на Главной и на
  // /money показывала бы разные числа. Без отдельной строки в карточке
  // Главной (места нет, три колонки уже заняты) — только в самой сумме.
  let payouts = 0;
  // Разбивка по способу оплаты — та же, что на /money (запрос пользователя
  // 2026-07-18: "должна быть аналогичная сводка как и в Деньгах, где видно
  // наличные и безналичные") — раньше на Главной была только общая сумма.
  let cash = 0;
  let mobile = 0;
  for (const op of operations) {
    const amount = Number(op.amount);
    if (op.type === "revenue" || op.type === "revenue_cashless") revenue += amount;
    if (op.type === "revenue") cash += amount;
    if (op.type === "revenue_cashless") mobile += amount;
    // Товары (docs/spec/09-goods.md, "равноправный слой" в выручке по дням) —
    // тот же принцип, что revenue/revenue_cashless выше. amount уже знаковый
    // (не Math.abs) — аннулирование продажи пишет отрицательную
    // компенсирующую операцию того же типа, корректно вычитается.
    if (op.type === "goods_revenue" || op.type === "goods_revenue_cashless") revenue += amount;
    if (op.type === "goods_revenue") cash += amount;
    if (op.type === "goods_revenue_cashless") mobile += amount;
    // Абонементы (пересмотрено 2026-07-25 — см. полный разбор в
    // reports/money/route.ts): выручка признаётся в момент ПОПОЛНЕНИЯ
    // (деньги реальны физически тогда же), не траты баланса —
    // revenue_abonement/goods_revenue_abonement сюда больше не входят.
    if (op.type === "abonement_topup" || op.type === "abonement_topup_cashless") revenue += amount;
    if (op.type === "abonement_topup") cash += amount;
    if (op.type === "abonement_topup_cashless") mobile += amount;
    if (op.type === "expense") expense += amount; // stored negative
    if (op.type === "advance" || op.type === "bonus_payout") payouts += amount; // stored negative
  }

  return {
    revenue,
    cash,
    mobile,
    profit: revenue + expense + payouts,
    submissionsCount: submissions.length,
    difference: totalDifference,
    expenses: expense,
    returnsCount: totalReturns,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundSummary(s: WindowSummary) {
  return {
    revenue: round2(s.revenue),
    cash: round2(s.cash),
    mobile: round2(s.mobile),
    profit: round2(s.profit),
    submissionsCount: s.submissionsCount,
    difference: round2(s.difference),
    expenses: round2(s.expenses),
    returnsCount: s.returnsCount,
  };
}

// "Последние итоги" на главной владельца (docs/design/prototype-owner-home-v1.html):
// для ОДНОЙ точки — сводка за её последний день с активностью. Для "Все
// точки" (pointIdParam отсутствует) — КАЖДАЯ точка тенанта берёт СВОЙ
// собственный последний день независимо, и уже эти суммы складываются
// (реальный баг, найден пользователем 2026-07-19: раньше "Все точки" брали
// один глобальный самый свежий день по всему тенанту — если сдавала только
// одна точка сегодня, а другая последний раз сдавала пару дней назад, вторая
// точка целиком пропадала из "Все точки", и агрегат совпадал 1-в-1 с одной
// точкой). Дата в ответе для "Все точки" — самая свежая среди точек,
// внёсших вклад; isToday=true, если хотя бы одна из них сдавала сегодня.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  // Фильтр по точке — опциональный (запрос пользователя 2026-07-16), по
  // умолчанию отсутствует = весь тенант сразу.
  const { searchParams } = new URL(request.url);
  const pointIdParam = searchParams.get("pointId");

  const { timezone, boundary } = await getTenantDayContext(owner.tenantId);
  const todayStart = dayBoundsFor(new Date(), timezone, boundary).start;

  if (pointIdParam) {
    const latest = await prisma.resultsSubmission.findFirst({
      where: { tenantId: owner.tenantId, pointId: pointIdParam },
      orderBy: { submittedAt: "desc" },
      select: { submittedAt: true },
    });
    if (!latest) {
      return NextResponse.json({ hasData: false });
    }
    const { start: dayStart, end: dayEnd } = dayBoundsFor(latest.submittedAt, timezone, boundary);
    const summary = await computeWindowSummary(owner.tenantId, pointIdParam, dayStart, dayEnd);
    return NextResponse.json({
      hasData: true,
      date: formatLocalDateKey(dayStart, timezone, boundary),
      isToday: dayStart.getTime() === todayStart.getTime(),
      ...roundSummary(summary),
    });
  }

  const points = await prisma.point.findMany({
    where: { tenantId: owner.tenantId },
    select: { id: true },
  });
  if (!points.length) {
    return NextResponse.json({ hasData: false });
  }

  const perPoint = await Promise.all(
    points.map(async (p) => {
      const latest = await prisma.resultsSubmission.findFirst({
        where: { tenantId: owner.tenantId, pointId: p.id },
        orderBy: { submittedAt: "desc" },
        select: { submittedAt: true },
      });
      if (!latest) return null;
      const { start: dayStart, end: dayEnd } = dayBoundsFor(latest.submittedAt, timezone, boundary);
      const summary = await computeWindowSummary(owner.tenantId, p.id, dayStart, dayEnd);
      return { dayStart, summary };
    })
  );

  const active = perPoint.filter((v): v is { dayStart: Date; summary: WindowSummary } => v !== null);
  if (!active.length) {
    return NextResponse.json({ hasData: false });
  }

  const maxDayStart = new Date(Math.max(...active.map((a) => a.dayStart.getTime())));
  const combined = active.reduce<WindowSummary>(
    (acc, a) => ({
      revenue: acc.revenue + a.summary.revenue,
      cash: acc.cash + a.summary.cash,
      mobile: acc.mobile + a.summary.mobile,
      profit: acc.profit + a.summary.profit,
      submissionsCount: acc.submissionsCount + a.summary.submissionsCount,
      difference: acc.difference + a.summary.difference,
      expenses: acc.expenses + a.summary.expenses,
      returnsCount: acc.returnsCount + a.summary.returnsCount,
    }),
    { revenue: 0, cash: 0, mobile: 0, profit: 0, submissionsCount: 0, difference: 0, expenses: 0, returnsCount: 0 }
  );

  return NextResponse.json({
    hasData: true,
    date: formatLocalDateKey(maxDayStart, timezone, boundary),
    isToday: maxDayStart.getTime() === todayStart.getTime(),
    ...roundSummary(combined),
  });
}
