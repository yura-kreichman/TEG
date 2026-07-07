import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

/**
 * Resolves the current session to an authenticated Owner and their tenant.
 * Returns null if there's no session, the user isn't an owner, or (defensively)
 * an owner somehow has no tenant.
 */
export async function requireOwner() {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "owner" || !user.tenantId) return null;

  return { user, tenantId: user.tenantId };
}

/** Loads a Zone and verifies it belongs to the given tenant (via its Point). */
export async function findTenantZone(tenantId: string, zoneId: string) {
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    include: { point: true },
  });
  if (!zone || zone.point.tenantId !== tenantId) return null;
  return zone;
}
