import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcSessions, calcZoneRevenue, isLaunchesZone, isStaysZone } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";

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

function dayStartOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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
        select: { zoneSubmissionId: true, amount: true, paymentMethod: true },
      })
    : [];
  const liveRevenueBySubmission = new Map<string, number>();
  // Абонемент — касса точки эту сумму уже получила раньше, при пополнении,
  // не сейчас — вычитается из calculatedRevenue при расчёте разницы ниже
  // (реальный баг, найден пользователем 2026-07-18: без вычитания разница
  // ложно показывала недостачу ровно на сумму пусков, оплаченных
  // абонементом).
  const liveAbonementBySubmission = new Map<string, number>();
  for (const l of liveLaunches) {
    if (!l.zoneSubmissionId) continue;
    const amount = Number(l.amount ?? 0);
    liveRevenueBySubmission.set(l.zoneSubmissionId, (liveRevenueBySubmission.get(l.zoneSubmissionId) ?? 0) + amount);
    if (l.paymentMethod === "abonement") {
      liveAbonementBySubmission.set(
        l.zoneSubmissionId,
        (liveAbonementBySubmission.get(l.zoneSubmissionId) ?? 0) + amount
      );
    }
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

      if (isStaysZone(zs.zone) || (isLaunchesZone(zs.zone) && zs.assetReadings.length === 0)) {
        const calculatedRevenue = liveRevenueBySubmission.get(zs.id) ?? 0;
        const abonementAmount = liveAbonementBySubmission.get(zs.id) ?? 0;
        totalDifference += actualCash + abonementAmount - calculatedRevenue;
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
      totalDifference += actualCash - calculatedRevenue;
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
  // Разбивка по способу оплаты — та же, что на /money (запрос пользователя
  // 2026-07-18: "должна быть аналогичная сводка как и в Деньгах, где видно
  // наличные и безналичные") — раньше на Главной была только общая сумма.
  let cash = 0;
  let mobile = 0;
  for (const op of operations) {
    const amount = Number(op.amount);
    if (op.type === "revenue" || op.type === "revenue_cashless" || op.type === "revenue_abonement") revenue += amount;
    if (op.type === "revenue") cash += amount;
    if (op.type === "revenue_cashless") mobile += amount;
    if (op.type === "expense") expense += amount; // stored negative
  }

  return {
    revenue,
    cash,
    mobile,
    profit: revenue + expense,
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

  const todayStart = dayStartOf(new Date());

  if (pointIdParam) {
    const latest = await prisma.resultsSubmission.findFirst({
      where: { tenantId: owner.tenantId, pointId: pointIdParam },
      orderBy: { submittedAt: "desc" },
      select: { submittedAt: true },
    });
    if (!latest) {
      return NextResponse.json({ hasData: false });
    }
    const dayStart = dayStartOf(latest.submittedAt);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const summary = await computeWindowSummary(owner.tenantId, pointIdParam, dayStart, dayEnd);
    return NextResponse.json({
      hasData: true,
      date: dayStart.toISOString().slice(0, 10),
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
      const dayStart = dayStartOf(latest.submittedAt);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
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
    date: maxDayStart.toISOString().slice(0, 10),
    isToday: maxDayStart.getTime() === todayStart.getTime(),
    ...roundSummary(combined),
  });
}
