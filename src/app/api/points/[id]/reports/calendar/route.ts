import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { getPeriodRange, isReportGranularity, round2 } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/calendar">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  // Тот же переключатель Неделя/Месяц/Год и тот же getPeriodRange, что у
  // остальных вкладок отчёта (Динамика/Зоны/Сотрудники) — раньше здесь было
  // отдельное жёстко зашитое окно "последние 4 недели", не связанное с
  // переключателем (фидбек пользователя: логика должна строиться из периода).
  const { searchParams } = new URL(request.url);
  const granularityParam = searchParams.get("granularity");
  const granularity = isReportGranularity(granularityParam) ? granularityParam : "week";
  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const { start, end } = getPeriodRange(granularity, todayStart, todayStart);

  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);

  const submissions = zoneIds.length
    ? await prisma.zoneSubmission.findMany({
        where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: start, lt: end } } },
        select: { cashAmount: true, mobileAmount: true, resultsSubmission: { select: { submittedAt: true } } },
      })
    : [];

  const byDay = new Map<string, number>();
  for (const s of submissions) {
    const key = s.resultsSubmission.submittedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(s.cashAmount) + Number(s.mobileAmount));
  }

  // "Год" — 12 месяцев, а не сетка дней недели: 52 строки нечитаемы на
  // телефоне, и сезонность за год показательнее по месяцам, чем по дням
  // недели (запрос пользователя 2026-07-15).
  if (granularity === "year") {
    const year = start.getUTCFullYear();
    const monthTotals = Array.from({ length: 12 }, () => 0);
    for (const [key, val] of byDay) {
      const m = Number(key.slice(5, 7)) - 1;
      monthTotals[m] += val;
    }
    const months = Array.from({ length: 12 }, (_, m) => {
      const monthStart = new Date(Date.UTC(year, m, 1));
      const hasData = monthStart < end;
      return { month: m, total: round2(hasData ? monthTotals[m] : 0), hasData };
    });

    let weakestMonth: number | null = null;
    let strongestMonth: number | null = null;
    months.forEach((mo) => {
      if (!mo.hasData) return;
      if (weakestMonth === null || mo.total < months[weakestMonth].total) weakestMonth = mo.month;
      if (strongestMonth === null || mo.total > months[strongestMonth].total) strongestMonth = mo.month;
    });
    const withData = months.filter((mo) => mo.hasData);
    const overallMonthAverage = withData.length ? withData.reduce((sum, mo) => sum + mo.total, 0) / withData.length : 0;
    const overloadedMonth =
      strongestMonth !== null && overallMonthAverage > 0 && months[strongestMonth].total >= overallMonthAverage * 1.8
        ? strongestMonth
        : null;

    return NextResponse.json({
      pointName: point.name,
      weeks: [],
      dowAverages: [],
      weakestDow: null,
      strongestDow: null,
      overloadedDow: null,
      overloadRatio: null,
      months,
      weakestMonth,
      strongestMonth,
      overloadedMonth,
      monthOverloadRatio: overloadedMonth !== null ? round2(months[overloadedMonth].total / overallMonthAverage) : null,
    });
  }

  // Неделя/Месяц — сетка строится полными неделями Пн–Вс, покрывающими
  // [start, end); дни за пределами периода (хвост соседнего месяца, будущее)
  // остаются hasData: false.
  const startDow = (start.getUTCDay() + 6) % 7; // 0=Пн
  const gridStart = new Date(start.getTime() - startDow * 24 * 60 * 60 * 1000);
  const lastDay = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const lastDow = (lastDay.getUTCDay() + 6) % 7;
  const gridEnd = new Date(lastDay.getTime() + (6 - lastDow) * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  const weeksCount = Math.round((gridEnd.getTime() - gridStart.getTime()) / (7 * 24 * 60 * 60 * 1000));

  const weeks: { weekStart: string; days: { date: string; dayOfWeek: number; total: number; hasData: boolean }[] }[] = [];
  const totalsByDow: number[][] = Array.from({ length: 7 }, () => []);

  for (let w = 0; w < weeksCount; w++) {
    const weekStart = new Date(gridStart.getTime() + w * 7 * 24 * 60 * 60 * 1000);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart.getTime() + d * 24 * 60 * 60 * 1000);
      const key = date.toISOString().slice(0, 10);
      const hasData = date >= start && date < end;
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
    months: null,
    weakestMonth: null,
    strongestMonth: null,
    overloadedMonth: null,
    monthOverloadRatio: null,
  });
}
