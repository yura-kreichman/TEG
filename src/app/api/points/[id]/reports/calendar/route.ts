import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { resolvePeriodFromParams, round2 } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/calendar">) {
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

  // Тот же переключатель День/Неделя/Месяц/Год/Период и тот же
  // resolvePeriodFromParams, что у остальных вкладок отчёта (Динамика/Зоны/
  // Сотрудники) — раньше здесь было отдельное жёстко зашитое окно "последние
  // 4 недели", не связанное с переключателем (фидбек пользователя: логика
  // должна строиться из периода).
  const { searchParams } = new URL(request.url);
  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const { start, end, granularity } = resolvePeriodFromParams(searchParams, todayStart);

  const zones = await prisma.zone.findMany({
    where: isAllPoints ? { point: { tenantId: owner.tenantId } } : { pointId },
    select: { id: true },
  });
  const zoneIds = zones.map((z) => z.id);

  const [submissions, abonementOps] = await Promise.all([
    zoneIds.length
      ? prisma.zoneSubmission.findMany({
          where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: start, lt: end } } },
          select: { cashAmount: true, mobileAmount: true, resultsSubmission: { select: { submittedAt: true } } },
        })
      : Promise.resolve([]),
    // Абонемент — не в cashAmount/mobileAmount (касса точки эти деньги
    // сейчас не получает, уже получила раньше, при пополнении), но реальная
    // выручка бизнеса — без неё тепловая карта занижала активность дней с
    // абонементными пусками (тот же разрыв, что и в /reports/counters/day,
    // запрос пользователя 2026-07-17/18).
    zoneIds.length
      ? prisma.moneyOperation.findMany({
          where: { type: "revenue_abonement", zoneId: { in: zoneIds }, occurredAt: { gte: start, lt: end } },
          select: { amount: true, occurredAt: true },
        })
      : Promise.resolve([]),
  ]);

  const byDay = new Map<string, number>();
  for (const s of submissions) {
    const key = s.resultsSubmission.submittedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(s.cashAmount) + Number(s.mobileAmount));
  }
  for (const op of abonementOps) {
    const key = op.occurredAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + Math.abs(Number(op.amount)));
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

    return NextResponse.json({ pointName, weeks: [], months });
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

  for (let w = 0; w < weeksCount; w++) {
    const weekStart = new Date(gridStart.getTime() + w * 7 * 24 * 60 * 60 * 1000);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart.getTime() + d * 24 * 60 * 60 * 1000);
      const key = date.toISOString().slice(0, 10);
      const hasData = date >= start && date < end;
      const total = hasData ? (byDay.get(key) ?? 0) : 0;
      days.push({ date: key, dayOfWeek: d, total: round2(total), hasData });
    }
    weeks.push({ weekStart: weekStart.toISOString().slice(0, 10), days });
  }

  return NextResponse.json({ pointName, weeks, months: null });
}
