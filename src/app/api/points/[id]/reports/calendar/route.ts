import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { round2 } from "@/lib/reports";

async function findTenantPoint(tenantId: string, pointId: string) {
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== tenantId) return null;
  return point;
}

const WEEKS = 4;

export async function GET(_request: Request, ctx: RouteContext<"/api/points/[id]/reports/calendar">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const end = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  // Grid starts on the Monday of the week WEEKS-1 weeks ago, so "today" always
  // lands in the last row regardless of which weekday it currently is.
  const todayDow = (todayStart.getUTCDay() + 6) % 7; // 0=Mon
  const gridStart = new Date(todayStart.getTime() - (WEEKS - 1) * 7 * 24 * 60 * 60 * 1000 - todayDow * 24 * 60 * 60 * 1000);

  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);

  const submissions = zoneIds.length
    ? await prisma.zoneSubmission.findMany({
        where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: gridStart, lt: end } } },
        select: { cashAmount: true, mobileAmount: true, resultsSubmission: { select: { submittedAt: true } } },
      })
    : [];

  const byDay = new Map<string, number>();
  for (const s of submissions) {
    const key = s.resultsSubmission.submittedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(s.cashAmount) + Number(s.mobileAmount));
  }

  const weeks: { weekStart: string; days: { date: string; dayOfWeek: number; total: number; hasData: boolean }[] }[] = [];
  const totalsByDow: number[][] = Array.from({ length: 7 }, () => []);

  for (let w = 0; w < WEEKS; w++) {
    const weekStart = new Date(gridStart.getTime() + w * 7 * 24 * 60 * 60 * 1000);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart.getTime() + d * 24 * 60 * 60 * 1000);
      const key = date.toISOString().slice(0, 10);
      const hasData = date < end;
      const total = hasData ? (byDay.get(key) ?? 0) : 0;
      if (hasData) totalsByDow[d].push(total);
      days.push({ date: key, dayOfWeek: d, total: round2(total), hasData });
    }
    weeks.push({ weekStart: weekStart.toISOString().slice(0, 10), days });
  }

  const dowAverages = totalsByDow.map((values) =>
    values.length ? round2(values.reduce((sum, v) => sum + v, 0) / values.length) : 0
  );
  const overallAverage = dowAverages.length ? dowAverages.reduce((sum, v) => sum + v, 0) / dowAverages.length : 0;

  let weakestDow: number | null = null;
  let strongestDow: number | null = null;
  dowAverages.forEach((avg, i) => {
    if (totalsByDow[i].length === 0) return;
    if (weakestDow === null || avg < dowAverages[weakestDow]) weakestDow = i;
    if (strongestDow === null || avg > dowAverages[strongestDow]) strongestDow = i;
  });

  // Generic overload flag — any day averaging notably above the rest, not a
  // hardcoded "Saturday" assumption (docs feedback: insights must be honest).
  const overloadedDow =
    strongestDow !== null && overallAverage > 0 && dowAverages[strongestDow] >= overallAverage * 1.8 ? strongestDow : null;

  return NextResponse.json({
    pointName: point.name,
    weeks,
    dowAverages,
    weakestDow,
    strongestDow,
    overloadedDow,
    overloadRatio: overloadedDow !== null ? round2(dowAverages[overloadedDow] / overallAverage) : null,
  });
}
