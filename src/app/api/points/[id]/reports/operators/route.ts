import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { computeZoneSubmissionRevenues, resolvePeriodFromParams, round2 } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/operators">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

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
  const today = new Date();
  // Часовой пояс тенанта (аудит 2026-07-25, повторная проверка) — см.
  // комментарий у getPeriodRange в lib/reports.ts.
  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const { start, end } = resolvePeriodFromParams(searchParams, today, tenant?.timezone ?? "UTC");

  const zones = await prisma.zone.findMany({
    where: isAllPoints ? { point: { tenantId: owner.tenantId } } : { pointId },
    select: { id: true },
  });
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
      // isOpen: открытая смена (docs/spec/05-work-time.md, "АВТО"), ещё
      // не начислена, не учитывается в отчёте до check-out.
      where: isAllPoints
        ? { point: { tenantId: owner.tenantId }, startAt: { gte: start, lt: end }, isOpen: false }
        : { pointId, startAt: { gte: start, lt: end }, isOpen: false },
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
  // Абонементная выручка (аудит 2026-07-24, то же расхождение, что и у
  // вкладки "Зоны" — см. комментарий в points/[id]/reports/zones/route.ts) —
  // MoneyOperation(revenue_abonement) всегда несёт performedByOperatorId
  // (см. spendWalletTx/spendWalletForZone/spendWalletForTicketOrderTx в
  // lib/abonement.ts), поэтому атрибуция по оператору строится тем же
  // прямым запросом, что и по зоне.
  const abonementOps = zoneIds.length
    ? await prisma.moneyOperation.findMany({
        where: { zoneId: { in: zoneIds }, type: "revenue_abonement", occurredAt: { gte: start, lt: end } },
        select: { performedByOperatorId: true, amount: true },
      })
    : [];
  for (const op of abonementOps) {
    if (!op.performedByOperatorId) continue;
    operatorIds.add(op.performedByOperatorId);
    revenueByOperator.set(
      op.performedByOperatorId,
      (revenueByOperator.get(op.performedByOperatorId) ?? 0) + Number(op.amount)
    );
  }
  for (const sh of shifts) operatorIds.add(sh.operatorId);

  if (operatorIds.size === 0) {
    return NextResponse.json({ pointName, operators: [] });
  }

  const [operatorRows, rates] = await Promise.all([
    prisma.operator.findMany({
      where: { id: { in: [...operatorIds] } },
      select: { id: true, name: true, colorTag: true, avatarUrl: true, iconKey: true },
    }),
    prisma.operatorRate.findMany({ where: { operatorId: { in: [...operatorIds] } }, orderBy: { effectiveFrom: "asc" } }),
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

  const shiftsByOperator = new Map<string, typeof shifts>();
  for (const sh of shifts) {
    const list = shiftsByOperator.get(sh.operatorId) ?? [];
    list.push(sh);
    shiftsByOperator.set(sh.operatorId, list);
  }

  const operators = operatorRows.map((op) => {
    const opShifts = shiftsByOperator.get(op.id) ?? [];
    const totalHours = opShifts.reduce((sum, sh) => sum + (sh.endAt!.getTime() - sh.startAt.getTime()) / 3_600_000, 0);
    const accrued = opShifts.reduce(
      (sum, sh) => sum + ((sh.endAt!.getTime() - sh.startAt.getTime()) / 3_600_000) * rateAt(op.id, sh.startAt),
      0
    );
    const opSubmissions = submissionsByOperator.get(op.id) ?? [];
    const revenue = revenueByOperator.get(op.id) ?? 0;
    const differenceSum = opSubmissions.reduce((sum, s) => sum + s.difference, 0);

    return {
      operatorId: op.id,
      name: op.name,
      colorTag: op.colorTag,
      avatarUrl: op.avatarUrl,
      iconKey: op.iconKey,
      shiftsCount: opShifts.length,
      totalHours: round2(totalHours),
      revenue: round2(revenue),
      revenuePerHour: totalHours > 0 ? round2(revenue / totalHours) : null,
      // "Начислено за период" — чистое начисление по ставке (часы × ставка),
      // без вычета авансов/премий (docs/spec/05-work-time.md, тот же принцип,
      // что и rateEarnedInPeriod в calcOperatorBalance/work-time.ts). Раньше
      // здесь вычитались авансы+премии — путало "начислено" с "к выдаче" и
      // premium-выплаты (не входящие в начисление по ставке вовсе) занижали
      // цифру ниже реальной заработанной суммы. Найдено аудитом 2026-07-12.
      accruedForPeriod: round2(accrued),
      differenceSum: round2(differenceSum),
    };
  });

  operators.sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({ pointName, operators });
}
