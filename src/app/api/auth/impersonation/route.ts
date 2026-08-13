import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getImpersonatingAdminId, getSession } from "@/lib/auth";
import { isSessionRevoked } from "@/lib/session-revocation";

// Статус имперсонации для баннера в кабинете владельца (docs/spec/
// 06-super-admin.md, п.4) — требует ОБА маркера сразу: маркер имперсонации
// сам по себе не должен пускать никого дальше, только вместе с валидной
// Owner-сессией (см. startImpersonation в src/lib/auth.ts).
export async function GET() {
  const adminId = await getImpersonatingAdminId();
  if (!adminId) {
    return NextResponse.json({ impersonating: false });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ impersonating: false });
  }

  const owner = await prisma.user.findUnique({ where: { id: session.userId }, include: { tenant: true } });
  // Отзыв сессий (второй проход аудита 2026-08-13) — иначе баннер
  // имперсонации показывал бы название чужого тенанта по уже обесцененной куке.
  if (!owner || owner.role !== "owner" || !owner.tenant || isSessionRevoked(session, owner.sessionsValidFrom)) {
    return NextResponse.json({ impersonating: false });
  }

  return NextResponse.json({ impersonating: true, tenantName: owner.tenant.name });
}
