import { prisma } from "@/lib/prisma";

/**
 * A zone-submission can only be corrected/deleted while it's still the last
 * link in the chain for every asset+tariff it touched — editing an earlier
 * entry would silently move the "previous reading" baseline a later
 * submission already calculated its sessions from (docs/spec/01-counters.md,
 * "Прозрачность"). Only "counters" zones have a chain at all — "launches"/
 * "cash_only" submissions don't depend on each other, so they're always
 * editable. Pass `accountingMode` if the caller already has it (avoids an
 * extra lookup); otherwise it's fetched here.
 */
export async function isZoneSubmissionEditable(
  zoneSubmissionId: string,
  accountingMode?: string
): Promise<boolean> {
  let mode = accountingMode;
  if (mode === undefined) {
    const zoneSubmission = await prisma.zoneSubmission.findUnique({
      where: { id: zoneSubmissionId },
      select: { zone: { select: { accountingMode: true } } },
    });
    mode = zoneSubmission?.zone.accountingMode;
  }
  if (mode !== "counters") return true;

  const readings = await prisma.assetReading.findMany({
    where: { zoneSubmissionId },
    select: { assetId: true, tariffId: true, createdAt: true },
  });
  if (readings.length === 0) return true;

  // One query for all touched asset+tariff pairs instead of one count per
  // reading — the (assetId, tariffId, createdAt) index makes each OR branch
  // an index lookup, so this stays a single round-trip regardless of how many
  // assets/tariffs the zone-submission covers.
  const laterReading = await prisma.assetReading.findFirst({
    where: {
      OR: readings.map((r) => ({
        assetId: r.assetId,
        tariffId: r.tariffId,
        createdAt: { gt: r.createdAt },
      })),
    },
    select: { id: true },
  });

  return laterReading === null;
}
