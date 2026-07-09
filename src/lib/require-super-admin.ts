import { prisma } from "@/lib/prisma";
import { getAdminSessionUserId } from "@/lib/auth";

/**
 * Resolves the current session to an authenticated platform Super Admin.
 * Own cookie, separate from Owner's (see src/lib/auth.ts) — logging into
 * /admin must not log the Owner out of the same browser, and vice versa.
 */
export async function requireSuperAdmin() {
  const userId = await getAdminSessionUserId();
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "super_admin") return null;

  return { user };
}
