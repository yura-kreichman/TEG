import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { localDateParts } from "@/lib/business-day";

const RANGE_DAYS: Record<string, number> = { today: 1, "7d": 7, "30d": 30 };

// Дневные агрегаты уже честные (докс: "Принцип честности" — только
// отфильтрованные реальные данные) — этот роут только суммирует то, что уже
// накоплено в LandingDailyStat, никакой дополнительной обработки.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rangeParam = searchParams.get("range") ?? "7d";
  const days = RANGE_DAYS[rangeParam] ?? RANGE_DAYS["7d"];

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const landing = await prisma.landing.findUnique({ where: { tenantId: owner.tenantId } });
  if (!landing || !tenant) {
    return NextResponse.json({ summary: { visits: 0, uniqueVisitors: 0 }, series: [], topSources: [] });
  }

  const { year, month, day } = localDateParts(new Date(), tenant.timezone);
  const todayUtc = new Date(Date.UTC(year, month - 1, day));
  const fromUtc = new Date(todayUtc);
  fromUtc.setUTCDate(fromUtc.getUTCDate() - (days - 1));

  const rows = await prisma.landingDailyStat.findMany({
    where: { landingId: landing.id, date: { gte: fromUtc, lte: todayUtc } },
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

  return NextResponse.json({
    summary: { visits: summary.visits, uniqueVisitors: summary.uniqueVisitors },
    series: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), visits: r.visits, uniqueVisitors: r.uniqueVisitors })),
    topSources,
  });
}
