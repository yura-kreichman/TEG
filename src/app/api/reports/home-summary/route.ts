import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcSessions, calcZoneRevenue, isLaunchesZone, isStaysZone } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";

// "Последние итоги" на главной владельца (docs/design/prototype-owner-home-v1.html):
// сводка за последний день, когда была хоть одна сдача итогов — по всем точкам
// тенанта, не по одной. Если сегодня уже что-то сдавали, это и есть тот день;
// если нет — берём последний прошедший день с активностью и отдельно говорим
// клиенту, что это не сегодня (isToday=false), чтобы карточка могла показать
// поясняющую заметку вместо того, чтобы выглядеть как "сегодняшний" итог.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  // Фильтр по точке — опциональный (запрос пользователя 2026-07-16), по
  // умолчанию отсутствует = весь тенант сразу, как и было раньше.
  const { searchParams } = new URL(request.url);
  const pointIdParam = searchParams.get("pointId");

  const latest = await prisma.resultsSubmission.findFirst({
    where: { tenantId: owner.tenantId, ...(pointIdParam ? { pointId: pointIdParam } : {}) },
    orderBy: { submittedAt: "desc" },
    select: { submittedAt: true },
  });

  if (!latest) {
    return NextResponse.json({ hasData: false });
  }

  const dayStart = new Date(
    Date.UTC(latest.submittedAt.getUTCFullYear(), latest.submittedAt.getUTCMonth(), latest.submittedAt.getUTCDate())
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const isToday = dayStart.getTime() === todayStart.getTime();

  const submissions = await prisma.resultsSubmission.findMany({
    where: {
      tenantId: owner.tenantId,
      submittedAt: { gte: dayStart, lt: dayEnd },
      ...(pointIdParam ? { pointId: pointIdParam } : {}),
    },
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
  for (const s of submissions) {
    for (const zs of s.zoneSubmissions) {
      if (zs.zone.accountingMode === "cash_only") continue;
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
      tenantId: owner.tenantId,
      occurredAt: { gte: dayStart, lt: dayEnd },
      ...(pointIdParam ? { OR: [{ zone: { pointId: pointIdParam } }, { pointId: pointIdParam }] } : {}),
    },
  });
  let revenue = 0;
  let expense = 0;
  for (const op of operations) {
    const amount = Number(op.amount);
    if (op.type === "revenue" || op.type === "revenue_cashless" || op.type === "revenue_abonement") revenue += amount;
    if (op.type === "expense") expense += amount; // stored negative
  }

  return NextResponse.json({
    hasData: true,
    date: dayStart.toISOString().slice(0, 10),
    isToday,
    revenue: Math.round(revenue * 100) / 100,
    profit: Math.round((revenue + expense) * 100) / 100,
    submissionsCount: submissions.length,
    difference: Math.round(totalDifference * 100) / 100,
    expenses: Math.round(expense * 100) / 100,
  });
}
