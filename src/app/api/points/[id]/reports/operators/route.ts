import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { computeZoneSubmissionRevenues, getPeriodRange, isReportGranularity, round2 } from "@/lib/reports";

async function findTenantPoint(tenantId: string, pointId: string) {
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== tenantId) return null;
  return point;
}

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/operators">) {
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

  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);

  const [entries, submissions, shifts] = await Promise.all([
    computeZoneSubmissionRevenues(zoneIds, start, end),
    zoneIds.length
      ? prisma.zoneSubmission.findMany({
          where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: start, lt: end } } },
          select: { id: true, resultsSubmission: { select: { operatorId: true, submittedAt: true } } },
        })
      : Promise.resolve([]),
    prisma.shift.findMany({
      where: { pointId, startAt: { gte: start, lt: end } },
      select: { id: true, operatorId: true, startAt: true, endAt: true },
    }),
  ]);

  const entryById = new Map(entries.map((e) => [e.zoneSubmissionId, e]));
  const operatorIds = new Set<string>();
  const revenueByOperator = new Map<string, number>();
  const submissionsByOperator = new Map<string, { submittedAt: Date; difference: number }[]>();
  for (const s of submissions) {
    const opId = s.resultsSubmission.operatorId;
    operatorIds.add(opId);
    const entry = entryById.get(s.id);
    if (!entry) continue;
    revenueByOperator.set(opId, (revenueByOperator.get(opId) ?? 0) + entry.actualTotal);
    const list = submissionsByOperator.get(opId) ?? [];
    list.push({ submittedAt: s.resultsSubmission.submittedAt, difference: entry.difference });
    submissionsByOperator.set(opId, list);
  }
  for (const sh of shifts) operatorIds.add(sh.operatorId);

  if (operatorIds.size === 0) {
    return NextResponse.json({ pointName: point.name, operators: [] });
  }

  const [operatorRows, rates, moneyOps] = await Promise.all([
    prisma.operator.findMany({ where: { id: { in: [...operatorIds] } }, select: { id: true, name: true, colorTag: true } }),
    prisma.operatorRate.findMany({ where: { operatorId: { in: [...operatorIds] } }, orderBy: { effectiveFrom: "asc" } }),
    prisma.moneyOperation.findMany({
      where: { pointId, type: { in: ["advance", "bonus_payout"] }, occurredAt: { gte: start, lt: end } },
      select: { performedByOperatorId: true, beneficiaryOperatorId: true, amount: true },
    }),
  ]);

  const ratesByOperator = new Map<string, { rate: number; effectiveFrom: Date }[]>();
  for (const r of rates) {
    const list = ratesByOperator.get(r.operatorId) ?? [];
    list.push({ rate: Number(r.rate), effectiveFrom: r.effectiveFrom });
    ratesByOperator.set(r.operatorId, list);
  }
  function rateAt(operatorId: string, at: Date): number {
    const list = ratesByOperator.get(operatorId) ?? [];
    let best = 0;
    for (const r of list) {
      if (r.effectiveFrom <= at) best = r.rate;
    }
    return best;
  }

  const payoutsByOperator = new Map<string, number>();
  for (const op of moneyOps) {
    const opId = op.beneficiaryOperatorId ?? op.performedByOperatorId;
    if (!opId) continue;
    payoutsByOperator.set(opId, (payoutsByOperator.get(opId) ?? 0) + Math.abs(Number(op.amount)));
  }

  const shiftsByOperator = new Map<string, typeof shifts>();
  for (const sh of shifts) {
    const list = shiftsByOperator.get(sh.operatorId) ?? [];
    list.push(sh);
    shiftsByOperator.set(sh.operatorId, list);
  }

  const operators = operatorRows.map((op) => {
    const opShifts = shiftsByOperator.get(op.id) ?? [];
    const totalHours = opShifts.reduce((sum, sh) => sum + (sh.endAt.getTime() - sh.startAt.getTime()) / 3_600_000, 0);
    const accrued = opShifts.reduce(
      (sum, sh) => sum + ((sh.endAt.getTime() - sh.startAt.getTime()) / 3_600_000) * rateAt(op.id, sh.startAt),
      0
    );
    const payouts = payoutsByOperator.get(op.id) ?? 0;

    const opSubmissions = submissionsByOperator.get(op.id) ?? [];
    const revenue = revenueByOperator.get(op.id) ?? 0;
    const differenceSum = opSubmissions.reduce((sum, s) => sum + s.difference, 0);

    const sorted = [...opSubmissions].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
    const lastThree = sorted.slice(-3);
    const hasNegativeStreak = lastThree.length === 3 && lastThree.every((s) => s.difference < 0);

    return {
      operatorId: op.id,
      name: op.name,
      colorTag: op.colorTag,
      shiftsCount: opShifts.length,
      totalHours: round2(totalHours),
      revenue: round2(revenue),
      revenuePerHour: totalHours > 0 ? round2(revenue / totalHours) : null,
      accruedForPeriod: round2(accrued - payouts),
      differenceSum: round2(differenceSum),
      hasNegativeStreak,
      recentDifferences: hasNegativeStreak ? lastThree.map((s) => round2(s.difference)) : [],
    };
  });

  operators.sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({ pointName: point.name, operators });
}
