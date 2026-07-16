import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcSessions, calcZoneRevenue } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";

// "Последние итоги" на главной владельца (docs/design/prototype-owner-home-v1.html):
// сводка за последний день, когда была хоть одна сдача итогов — по всем точкам
// тенанта, не по одной. Если сегодня уже что-то сдавали, это и есть тот день;
// если нет — берём последний прошедший день с активностью и отдельно говорим
// клиенту, что это не сегодня (isToday=false), чтобы карточка могла показать
// поясняющую заметку вместо того, чтобы выглядеть как "сегодняшний" итог.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const latest = await prisma.resultsSubmission.findFirst({
    where: { tenantId: owner.tenantId },
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
    where: { tenantId: owner.tenantId, submittedAt: { gte: dayStart, lt: dayEnd } },
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

  let totalDifference = 0;
  for (const s of submissions) {
    for (const zs of s.zoneSubmissions) {
      if (zs.zone.accountingMode === "cash_only") continue;
      const isLaunches = zs.zone.accountingMode === "launches";
      const tariffCalc = zs.zone.tariffs.map((tariff) => ({
        tariffId: tariff.id,
        price: Number(tariff.price),
        sessions: zs.assetReadings
          .filter((r) => r.tariffId === tariff.id)
          .reduce((sum, r) => sum + (isLaunches ? r.reading : (sessionsById.get(r.id) ?? 0)), 0),
      }));
      const calculatedRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);
      const actualCash = Number(zs.cashAmount) + Number(zs.mobileAmount);
      totalDifference += actualCash - calculatedRevenue;
    }
  }

  const operations = await prisma.moneyOperation.findMany({
    where: { tenantId: owner.tenantId, occurredAt: { gte: dayStart, lt: dayEnd } },
  });
  let revenue = 0;
  let expense = 0;
  for (const op of operations) {
    const amount = Number(op.amount);
    if (op.type === "revenue" || op.type === "revenue_cashless") revenue += amount;
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
