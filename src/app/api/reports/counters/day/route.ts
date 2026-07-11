import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcSessions, calcZoneRevenue } from "@/lib/results-calc";

interface CorrectionDiff {
  cashAmount: number;
  mobileAmount: number;
  returnsCount: number;
  readings: Record<string, number>;
}

// Compact per-day breakdown for a point: one card per zone-submission that
// day (docs/design/prototype-owner-readings-v1.html), with the reading chain
// (previous → current) per tariff, cash/mobile, расчётная выручка/разница
// (recomputed here — only raw cashAmount/mobileAmount/returnsCount/readings
// are persisted, not the derived numbers), whether the card is still the last
// link in its assets' chains (editable), and audit info from CorrectionLog.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");
  const date = searchParams.get("date"); // "YYYY-MM-DD"

  if (!pointId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const submissions = await prisma.resultsSubmission.findMany({
    where: { pointId, submittedAt: { gte: dayStart, lt: dayEnd } },
    include: {
      operator: { select: { name: true } },
      zoneSubmissions: {
        include: {
          zone: { include: { tariffs: true, assets: { orderBy: { sortOrder: "asc" } } } },
          assetReadings: true,
        },
      },
    },
    // Newest submission first — that's the one an owner is most likely checking
    // (and the only one still editable, per the lock-chain rule below).
    orderBy: { submittedAt: "desc" },
  });

  if (submissions.length === 0) {
    return NextResponse.json({ cards: [] });
  }

  // Sessions/previous-value are always computed from the immediately preceding
  // reading of the same asset+tariff, regardless of date — so we walk the
  // asset's whole reading history chronologically rather than only this day's
  // rows. The same pass also tells us, per reading, whether it's the LAST one
  // recorded for its asset+tariff — i.e. whether its zone-submission is still
  // editable (see docs/spec/01-counters.md, "Прозрачность"). Only "counters"
  // zones have this chain at all — "launches" readings are already the
  // finished count, "cash_only" zones have no readings to begin with.
  const assetIds = new Set<string>();
  for (const s of submissions) {
    for (const zs of s.zoneSubmissions) {
      if (zs.zone.accountingMode !== "counters") continue;
      for (const r of zs.assetReadings) assetIds.add(r.assetId);
    }
  }

  const allReadings = assetIds.size
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: [...assetIds] } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const runningPrevious = new Map<string, number>();
  const previousById = new Map<string, number>();
  const sessionsById = new Map<string, number>();
  const lastReadingIdByKey = new Map<string, string>();
  for (const r of allReadings) {
    const key = `${r.assetId}:${r.tariffId}`;
    const previous = runningPrevious.get(key) ?? 0;
    previousById.set(r.id, previous);
    sessionsById.set(r.id, calcSessions(r.reading, previous));
    runningPrevious.set(key, r.reading);
    lastReadingIdByKey.set(key, r.id);
  }

  const zoneSubmissionIds = submissions.flatMap((s) => s.zoneSubmissions.map((zs) => zs.id));
  const correctionLogs = zoneSubmissionIds.length
    ? await prisma.correctionLog.findMany({
        where: { entityType: "ZoneSubmission", entityId: { in: zoneSubmissionIds } },
        orderBy: { correctedAt: "desc" },
      })
    : [];
  const latestLogByZoneSubmissionId = new Map<string, (typeof correctionLogs)[number]>();
  for (const log of correctionLogs) {
    if (!latestLogByZoneSubmissionId.has(log.entityId)) latestLogByZoneSubmissionId.set(log.entityId, log);
  }

  const cards = submissions.flatMap((s) =>
    s.zoneSubmissions.map((zs) => {
      const isLaunches = zs.zone.accountingMode === "launches";
      const readingSessions = (r: (typeof zs.assetReadings)[number]) =>
        isLaunches ? r.reading : (sessionsById.get(r.id) ?? 0);

      const tariffCalc = zs.zone.tariffs.map((tariff) => ({
        tariffId: tariff.id,
        price: Number(tariff.price),
        sessions: zs.assetReadings
          .filter((r) => r.tariffId === tariff.id)
          .reduce((sum, r) => sum + readingSessions(r), 0),
      }));

      const calculatedRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);
      const actualCash = Number(zs.cashAmount) + Number(zs.mobileAmount);
      const difference = Math.round((actualCash - calculatedRevenue) * 100) / 100;

      const editable =
        zs.zone.accountingMode !== "counters" ||
        zs.assetReadings.every((r) => lastReadingIdByKey.get(`${r.assetId}:${r.tariffId}`) === r.id);

      const log = latestLogByZoneSubmissionId.get(zs.id);
      const before = log?.beforeJson as CorrectionDiff | undefined;
      const after = log?.afterJson as CorrectionDiff | undefined;
      const cashEditedBefore = before && after && before.cashAmount !== after.cashAmount ? before.cashAmount : null;
      const edited = log ? { at: log.correctedAt, reason: log.comment } : null;

      const assets = zs.zone.assets
        .map((asset) => ({
          assetId: asset.id,
          assetName: asset.name,
          colorTag: asset.colorTag,
          photoUrl: asset.photoUrl,
          iconKey: asset.iconKey,
          readings: zs.assetReadings
            .filter((r) => r.assetId === asset.id)
            .map((r) => {
              const tariff = zs.zone.tariffs.find((t) => t.id === r.tariffId);
              const key = `${asset.id}:${tariff?.id}`;
              const editedBefore =
                before && after && before.readings[key] !== after.readings[key] ? before.readings[key] : null;
              return {
                tariffId: r.tariffId,
                tariffName: tariff?.name ?? "",
                previousValue: isLaunches ? null : (previousById.get(r.id) ?? 0),
                value: r.reading,
                sessions: readingSessions(r),
                editedBefore,
              };
            }),
        }))
        .filter((a) => a.readings.length > 0);

      return {
        zoneSubmissionId: zs.id,
        zoneId: zs.zoneId,
        zoneName: zs.zone.name,
        accountingMode: zs.zone.accountingMode,
        submittedAt: s.submittedAt,
        operatorName: s.operator.name,
        editable,
        edited,
        cashAmount: Number(zs.cashAmount),
        cashEditedBefore,
        mobileAmount: Number(zs.mobileAmount),
        returnsCount: zs.returnsCount,
        calculatedRevenue,
        difference,
        assets,
      };
    })
  );

  return NextResponse.json({ cards });
}
