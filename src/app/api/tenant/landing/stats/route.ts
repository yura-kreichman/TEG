import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { localDateParts } from "@/lib/business-day";
import { resolvePeriodFromParams } from "@/lib/reports";

// Дневные агрегаты уже честные (докс: "Принцип честности" — только
// отфильтрованные реальные данные) — этот роут только суммирует то, что уже
// накоплено в LandingDailyStat, никакой дополнительной обработки.
//
// Тот же переключатель День/Неделя/Месяц/Год/Период, что у Денег/Товаров/
// Отчётов (запрос пользователя 2026-07-20), вместо отдельного Сегодня/7д/30д —
// resolvePeriodFromParams общий для всех этих роутов (src/lib/reports.ts).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const landing = await prisma.landing.findUnique({ where: { tenantId: owner.tenantId } });
  if (!landing || !tenant) {
    return NextResponse.json({ summary: { visits: 0, uniqueVisitors: 0 }, series: [], topSources: [] });
  }

  const { searchParams } = new URL(request.url);
  const { year, month, day } = localDateParts(new Date(), tenant.timezone);
  const todayUtc = new Date(Date.UTC(year, month - 1, day));
  const { start, end, granularity } = resolvePeriodFromParams(searchParams, todayUtc);
  // LandingDailyStat.date — полночь UTC на календарный день (без времени),
  // [start, end) от resolvePeriodFromParams эксклюзивен по концу — lte
  // сработал бы неверно на границе дня, поэтому lt(end) - 1ms эквивалентно
  // "последний день периода включительно".
  const lastDayInclusive = new Date(end.getTime() - 1);

  const rows = await prisma.landingDailyStat.findMany({
    where: { landingId: landing.id, date: { gte: start, lte: lastDayInclusive } },
    orderBy: { date: "asc" },
  });

  const summary = rows.reduce(
    (acc, r) => ({
      visits: acc.visits + r.visits,
      uniqueVisitors: acc.uniqueVisitors + r.uniqueVisitors,
      sourceDirect: acc.sourceDirect + r.sourceDirect,
      sourceSearch: acc.sourceSearch + r.sourceSearch,
      sourceSocial: acc.sourceSocial + r.sourceSocial,
    }),
    { visits: 0, uniqueVisitors: 0, sourceDirect: 0, sourceSearch: 0, sourceSocial: 0 }
  );

  const topSources = (
    [
      ["direct", summary.sourceDirect],
      ["search", summary.sourceSearch],
      ["social", summary.sourceSocial],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));

  // "Год" — 12 месячных строк, а не 365 дневных (тот же приём, что в
  // Отчётах/CalendarMonthsTab): список "По дням" на весь год иначе
  // нечитаем.
  let series: { date: string; visits: number; uniqueVisitors: number }[];
  if (granularity === "year") {
    const byMonth = new Map<string, { visits: number; uniqueVisitors: number }>();
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 7);
      const acc = byMonth.get(key) ?? { visits: 0, uniqueVisitors: 0 };
      acc.visits += r.visits;
      acc.uniqueVisitors += r.uniqueVisitors;
      byMonth.set(key, acc);
    }
    series = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ date: `${key}-01`, ...v }));
  } else {
    series = rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), visits: r.visits, uniqueVisitors: r.uniqueVisitors }));
  }

  return NextResponse.json({
    summary: { visits: summary.visits, uniqueVisitors: summary.uniqueVisitors },
    period: { granularity },
    series,
    topSources,
  });
}
