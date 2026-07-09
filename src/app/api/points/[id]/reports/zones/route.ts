import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import {
  computeZoneSubmissionRevenues,
  getPeriodRange,
  isReportGranularity,
  round2,
  sumByKey,
} from "@/lib/reports";

async function findTenantPoint(tenantId: string, pointId: string) {
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== tenantId) return null;
  return point;
}

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/zones">) {
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

  const zones = await prisma.zone.findMany({
    where: { pointId },
    include: { assets: true, tariffs: true },
    orderBy: { createdAt: "asc" },
  });
  const zoneIds = zones.map((z) => z.id);
  const entries = await computeZoneSubmissionRevenues(zoneIds, start, end);

  const actualByZone = new Map<string, number>();
  for (const e of entries) {
    actualByZone.set(e.zoneId, (actualByZone.get(e.zoneId) ?? 0) + e.actualTotal);
  }
  const pointTotal = [...actualByZone.values()].reduce((sum, v) => sum + v, 0);

  const zoneRanking = zones
    .map((z) => {
      const total = actualByZone.get(z.id) ?? 0;
      return {
        zoneId: z.id,
        zoneName: z.name,
        iconKey: z.iconKey,
        total: round2(total),
        sharePercent: pointTotal > 0 ? Math.round((total / pointTotal) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const requestedZoneId = searchParams.get("zoneId");
  const drillZoneId = requestedZoneId && zoneIds.includes(requestedZoneId) ? requestedZoneId : zoneRanking[0]?.zoneId;
  const drillZone = zones.find((z) => z.id === drillZoneId) ?? null;

  let assetRanking: { assetId: string; assetName: string; colorTag: string; total: number; sharePercent: number }[] = [];
  let tariffBreakdown: { tariffId: string; tariffName: string; total: number; sharePercent: number }[] = [];
  let insight: { type: "lowAssetShare"; assetName: string; sharePercent: number; expectedSharePercent: number } | null =
    null;

  if (drillZone) {
    const zoneEntries = entries.filter((e) => e.zoneId === drillZone.id);
    const zoneActualTotal = actualByZone.get(drillZone.id) ?? 0;
    const perAssetRaw = sumByKey(zoneEntries, "perAsset");
    const perTariffRaw = sumByKey(zoneEntries, "perTariff");
    const rawTotal = [...perAssetRaw.values()].reduce((sum, v) => sum + v, 0);
    // Scale the calculated (session×price) split so it sums exactly to the zone's
    // real reported total (cash+mobile) rather than the theoretical figure —
    // same "actual is ground truth, calculated is only for splitting" idea as
    // the difference/calculatedRevenue distinction elsewhere in the app.
    const scale = rawTotal > 0 ? zoneActualTotal / rawTotal : 0;

    assetRanking = drillZone.assets
      .map((a) => {
        const total = (perAssetRaw.get(a.id) ?? 0) * scale;
        return {
          assetId: a.id,
          assetName: a.name,
          colorTag: a.colorTag,
          total: round2(total),
          sharePercent: zoneActualTotal > 0 ? Math.round((total / zoneActualTotal) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    tariffBreakdown = drillZone.tariffs
      .map((t) => {
        const total = (perTariffRaw.get(t.id) ?? 0) * scale;
        return {
          tariffId: t.id,
          tariffName: t.name,
          total: round2(total),
          sharePercent: zoneActualTotal > 0 ? Math.round((total / zoneActualTotal) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    // Flag an asset earning well below its "fair share" (1/N of the zone) when
    // there's more than one asset to compare against — a genuine computed
    // check, not a canned string (docs feedback: insights must be honest).
    if (assetRanking.length > 1) {
      const expectedShare = 100 / assetRanking.length;
      const weakest = assetRanking[assetRanking.length - 1];
      if (weakest.sharePercent < expectedShare * 0.5) {
        insight = {
          type: "lowAssetShare",
          assetName: weakest.assetName,
          sharePercent: weakest.sharePercent,
          expectedSharePercent: Math.round(expectedShare * 10) / 10,
        };
      }
    }
  }

  return NextResponse.json({
    pointName: point.name,
    period: { granularity, start: start.toISOString(), end: end.toISOString() },
    zoneRanking,
    drillZoneId: drillZone?.id ?? null,
    drillZoneName: drillZone?.name ?? null,
    assetRanking,
    tariffBreakdown,
    insight,
  });
}
