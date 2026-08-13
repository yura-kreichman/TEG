import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { isSessionRevoked } from "@/lib/session-revocation";

/**
 * Resolves the current session to an authenticated platform Super Admin.
 * Own cookie, separate from Owner's (see src/lib/auth.ts) — logging into
 * /admin must not log the Owner out of the same browser, and vice versa.
 */
export async function requireSuperAdmin() {
  const session = await getAdminSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.role !== "super_admin") return null;
  // Смена пароля обесценивает ранее выданные сессии (аудит 2026-08-13) —
  // для платформенной панели это тем более обязательно: её сессия открывает
  // все тенанты сразу. См. lib/session-revocation.ts.
  if (isSessionRevoked(session, user.sessionsValidFrom)) return null;

  return { user };
}
