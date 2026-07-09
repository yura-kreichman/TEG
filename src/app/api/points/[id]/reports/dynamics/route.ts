import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import {
  computeZoneSubmissionRevenues,
  getPeriodRange,
  getPreviousPeriodRange,
  isReportGranularity,
  round2,
} from "@/lib/reports";

async function findTenantPoint(tenantId: string, pointId: string) {
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== tenantId) return null;
  return point;
}

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/dynamics">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const granularityParam = searchParams.get("granularity");
  const granularity = isReportGranularity(granularityParam) ? granularityParam : "week";
  const anchorParam = searchParams.get("anchor");
  const today = new Date();
  const anchor = anchorParam && /^\d{4}-\d{2}-\d{2}$/.test(anchorParam) ? new Date(`${anchorParam}T00:00:00.000Z`) : today;

  const { start, end } = getPeriodRange(granularity, anchor, today);
  const { start: prevStart, end: prevEnd } = getPreviousPeriodRange(granularity, start);

  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
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
      OR: [{ zone: { pointId } }, { pointId }],
    },
    select: { type: true, amount: true },
  });
  let expenses = 0;
  let payouts = 0;
  for (const op of moneyOps) {
    const amount = Math.abs(Number(op.amount));
    if (op.type === "expense") expenses += amount;
    if (op.type === "advance" || op.type === "bonus_payout") payouts += amount;
  }

  const bars: { date: string; total: number }[] = [];
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    const key = d.toISOString().slice(0, 10);
    bars.push({ date: key, total: round2(byDay.get(key) ?? 0) });
  }

  return NextResponse.json({
    pointName: point.name,
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
