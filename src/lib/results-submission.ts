import { prisma } from "@/lib/prisma";

/**
 * A zone-submission can only be corrected/deleted while it's still the last
 * link in the chain for every asset+tariff it touched — editing an earlier
 * entry would silently move the "previous reading" baseline a later
 * submission already calculated its sessions from (docs/spec/01-counters.md,
 * "Прозрачность").
 */
export async function isZoneSubmissionEditable(zoneSubmissionId: string): Promise<boolean> {
  const readings = await prisma.assetReading.findMany({
    where: { zoneSubmissionId },
    select: { assetId: true, tariffId: true, createdAt: true },
  });

  for (const reading of readings) {
    const laterCount = await prisma.assetReading.count({
      where: {
        assetId: reading.assetId,
        tariffId: reading.tariffId,
        createdAt: { gt: reading.createdAt },
      },
    });
    if (laterCount > 0) return false;
  }

  return true;
}
