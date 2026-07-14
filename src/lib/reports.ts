import { prisma } from "@/lib/prisma";
import { calcSessions, calcZoneRevenue } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";

export type ReportGranularity = "week" | "month";
export type PeriodGranularity = "day" | "week" | "month" | "year";

export function isReportGranularity(value: unknown): value is ReportGranularity {
  return value === "week" || value === "month";
}

export function isPeriodGranularity(value: unknown): value is PeriodGranularity {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

/**
 * Calendar period (day/week/month/year) containing `anchor`, truncated to
 * `today` so an in-progress period doesn't silently include days that
 * haven't happened yet. Shared by the per-point reports (week/month only,
 * via `ReportGranularity`) and /api/reports/money (all four).
 */
export function getPeriodRange(granularity: PeriodGranularity, anchor: Date, today: Date) {
  let start: Date;
  let end: Date;
  if (granularity === "day") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  } else if (granularity === "week") {
    const dayIndex = (anchor.getUTCDay() + 6) % 7; // 0=Mon
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - dayIndex));
    end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (granularity === "month") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  } else {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear() + 1, 0, 1));
  }
  const todayEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  if (end > todayEnd) end = todayEnd;
  return { start, end };
}

/** Same-length period immediately before `start` — for the "vs previous period" delta. */
export function getPreviousPeriodRange(granularity: ReportGranularity, start: Date) {
  if (granularity === "week") {
    return { start: new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000), end: start };
  }
  const prevMonthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  return { start: prevMonthStart, end: start };
}

export interface ZoneSubmissionRevenue {
  zoneSubmissionId: string;
  zoneId: string;
  calculatedRevenue: number;
  actualCash: number;
  actualMobile: number;
  actualTotal: number;
  difference: number;
  perAsset: Map<string, number>; // assetId -> calculated revenue share (before proportional scaling)
  perTariff: Map<string, number>; // tariffId -> calculated revenue share
}

/**
 * Recomputes calculatedRevenue/difference and per-asset/per-tariff revenue
 * shares for every zone-submission of the given zones within [start, end) —
 * same chain-walking approach as /api/reports/counters/day (sessions/previous
 * reading are never persisted, only raw AssetReading.reading values are).
 * Walks each asset+tariff's FULL history (not just the window) so sessions at
 * the window's start are still diffed against the correct previous reading.
 */
export async function computeZoneSubmissionRevenues(
  zoneIds: string[],
  start: Date,
  end: Date
): Promise<ZoneSubmissionRevenue[]> {
  if (zoneIds.length === 0) return [];

  const zones = await prisma.zone.findMany({
    where: { id: { in: zoneIds } },
    include: { tariffs: true },
  });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const zoneSubmissions = await prisma.zoneSubmission.findMany({
    where: {
      zoneId: { in: zoneIds },
      resultsSubmission: { submittedAt: { gte: start, lt: end } },
    },
    include: { assetReadings: true, resultsSubmission: { select: { submittedAt: true, operatorId: true } } },
  });
  if (zoneSubmissions.length === 0) return [];

  const assetIds = new Set<string>();
  for (const zs of zoneSubmissions) {
    const zone = zoneById.get(zs.zoneId);
    if (zone?.accountingMode !== "counters") continue;
    for (const r of zs.assetReadings) assetIds.add(r.assetId);
  }

  const allReadings = assetIds.size
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: [...assetIds] } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  // Начальные (калибровочные) показания — сидируют "предыдущее" для самой
  // ПЕРВОЙ настоящей сдачи каждой пары актив+тариф; дальше цепочка считается
  // от реальных AssetReading как обычно (см. src/lib/asset-initial-readings.ts).
  const initialByKey = await getInitialReadingsMap([...assetIds]);

  const runningPrevious = new Map<string, number>(initialByKey);
  const sessionsById = new Map<string, number>();
  for (const r of allReadings) {
    const key = `${r.assetId}:${r.tariffId}`;
    const previous = runningPrevious.get(key) ?? 0;
    sessionsById.set(r.id, calcSessions(r.reading, previous));
    runningPrevious.set(key, r.reading);
  }

  return zoneSubmissions.map((zs) => {
    const zone = zoneById.get(zs.zoneId)!;
    const isLaunches = zone.accountingMode === "launches";
    const sessionsFor = (r: (typeof zs.assetReadings)[number]) => (isLaunches ? r.reading : (sessionsById.get(r.id) ?? 0));

    const tariffCalc = zone.tariffs.map((tariff) => ({
      tariffId: tariff.id,
      price: Number(tariff.price),
      sessions: zs.assetReadings.filter((r) => r.tariffId === tariff.id).reduce((sum, r) => sum + sessionsFor(r), 0),
    }));
    const calculatedRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);

    const actualCash = Number(zs.cashAmount);
    const actualMobile = Number(zs.mobileAmount);
    const actualTotal = actualCash + actualMobile;
    const difference = Math.round((actualTotal - calculatedRevenue) * 100) / 100;

    const perAsset = new Map<string, number>();
    const perTariff = new Map<string, number>();
    const priceByTariff = new Map(zone.tariffs.map((t) => [t.id, Number(t.price)]));
    for (const r of zs.assetReadings) {
      const revenue = sessionsFor(r) * (priceByTariff.get(r.tariffId) ?? 0);
      perAsset.set(r.assetId, (perAsset.get(r.assetId) ?? 0) + revenue);
      perTariff.set(r.tariffId, (perTariff.get(r.tariffId) ?? 0) + revenue);
    }

    return {
      zoneSubmissionId: zs.id,
      zoneId: zs.zoneId,
      calculatedRevenue,
      actualCash,
      actualMobile,
      actualTotal,
      difference,
      perAsset,
      perTariff,
    };
  });
}

/** Sums a Map<string, number> field of ZoneSubmissionRevenue entries into a single per-key total. */
export function sumByKey(entries: ZoneSubmissionRevenue[], field: "perAsset" | "perTariff"): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    for (const [key, value] of entry[field]) {
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }
  return totals;
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}
