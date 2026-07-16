import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import {
  computeZoneSubmissionRevenues,
  getPeriodRange,
  getPreviousPeriodRange,
  isReportGranularity,
  round2,
} from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/dynamics">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  // "all" — псевдо-ID для опции "Все точки" в дропдауне (запрос пользователя
  // 2026-07-16): агрегация по всему тенанту вместо одной точки, тот же
  // приём, что уже был на /money (там — просто отсутствие pointId вовсе,
  // здесь — отдельный URL-сегмент, т.к. маршрут /reports/[pointId] требует id).
  const { id: pointId } = await ctx.params;
  const isAllPoints = pointId === "all";
  let pointName: string | null = null;
  if (!isAllPoints) {
    const point = await findTenantPoint(owner.tenantId, pointId);
    if (!point) {
      return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
    }
    pointName = point.name;
  }

  const { searchParams } = new URL(request.url);
  const granularityParam = searchParams.get("granularity");
  const granularity = isReportGranularity(granularityParam) ? granularityParam : "week";
  const anchorParam = searchParams.get("anchor");
  const today = new Date();
  const anchor = anchorParam && /^\d{4}-\d{2}-\d{2}$/.test(anchorParam) ? new Date(`${anchorParam}T00:00:00.000Z`) : today;

  const { start, end } = getPeriodRange(granularity, anchor, today);
  const { start: prevStart, end: prevEnd } = getPreviousPeriodRange(granularity, start);

  const zones = await prisma.zone.findMany({
    where: isAllPoints ? { point: { tenantId: owner.tenantId } } : { pointId },
    select: { id: true },
  });
  const zoneIds = zones.map((z) => z.id);

  const entries = await computeZoneSubmissionRevenues(zoneIds, start, end);

  let totalCash = 0;
  let totalMobile = 0;
  const byDay = new Map<string, number>();
  for (const e of entries) {
    totalCash += e.actualCash;
    totalMobile += e.actualMobile;
  }

  const submissions = zoneIds.length
    ? await prisma.zoneSubmission.findMany({
        where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: start, lt: end } } },
        select: { cashAmount: true, mobileAmount: true, resultsSubmission: { select: { id: true, submittedAt: true } } },
      })
    : [];
  const submissionIds = new Set<string>();
  for (const s of submissions) {
    submissionIds.add(s.resultsSubmission.id);
    const dayKey = s.resultsSubmission.submittedAt.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + Number(s.cashAmount) + Number(s.mobileAmount));
  }

  // Previous period: only need the actual total for the delta%, no chain-walk needed.
  const prevSubmissions = zoneIds.length
    ? await prisma.zoneSubmission.findMany({
        where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: prevStart, lt: prevEnd } } },
        select: { cashAmount: true, mobileAmount: true },
      })
    : [];
  const prevTotal = prevSubmissions.reduce((sum, s) => sum + Number(s.cashAmount) + Number(s.mobileAmount), 0);

  const total = totalCash + totalMobile;
  const deltaPercent = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null;

  const moneyOps = await prisma.moneyOperation.findMany({
    where: {
      tenantId: owner.tenantId,
      occurredAt: { gte: start, lt: end },
      ...(isAllPoints ? {} : { OR: [{ zone: { pointId } }, { pointId }] }),
    },
    select: { type: true, amount: true, occurredAt: true },
  });
  let expenses = 0;
  let payouts = 0;
  // По дням — для линии "Прибыль" на графике (запрос пользователя 2026-07-16:
  // "и Выручку, и Прибыль двумя разными цветами"), тот же принцип, что byDay
  // для выручки выше.
  const deductionsByDay = new Map<string, number>();
  for (const op of moneyOps) {
    const amount = Math.abs(Number(op.amount));
    if (op.type === "expense") expenses += amount;
    if (op.type === "advance" || op.type === "bonus_payout") payouts += amount;
    if (op.type === "expense" || op.type === "advance" || op.type === "bonus_payout") {
      const key = op.occurredAt.toISOString().slice(0, 10);
      deductionsByDay.set(key, (deductionsByDay.get(key) ?? 0) + amount);
    }
  }

  // За год — 365 ежедневных столбцов на графике нечитаемы, агрегируем по
  // месяцам (12 столбцов), как и с "Неделя"/"Месяц" — по дням.
  const bars: { date: string; total: number; profit: number }[] = [];
  if (granularity === "year") {
    const byMonth = new Map<string, number>();
    const deductionsByMonth = new Map<string, number>();
    for (const [dayKey, value] of byDay) {
      const monthKey = dayKey.slice(0, 7);
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + value);
    }
    for (const [dayKey, value] of deductionsByDay) {
      const monthKey = dayKey.slice(0, 7);
      deductionsByMonth.set(monthKey, (deductionsByMonth.get(monthKey) ?? 0) + value);
    }
    for (let m = new Date(start); m < end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
      const revenueForBar = byMonth.get(key) ?? 0;
      const deductionsForBar = deductionsByMonth.get(key) ?? 0;
      bars.push({ date: `${key}-01`, total: round2(revenueForBar), profit: round2(revenueForBar - deductionsForBar) });
    }
  } else {
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      const key = d.toISOString().slice(0, 10);
      const revenueForBar = byDay.get(key) ?? 0;
      const deductionsForBar = deductionsByDay.get(key) ?? 0;
      bars.push({ date: key, total: round2(revenueForBar), profit: round2(revenueForBar - deductionsForBar) });
    }
  }

  return NextResponse.json({
    pointName,
    period: { granularity, start: start.toISOString(), end: end.toISOString() },
    total: round2(total),
    cash: round2(totalCash),
    mobile: round2(totalMobile),
    submissionsCount: submissionIds.size,
    deltaPercent,
    bars,
    profitAndLoss: {
      revenue: round2(total),
      expenses: round2(expenses),
      payouts: round2(payouts),
      profit: round2(total - expenses - payouts),
    },
  });
}
