import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getImpersonatingAdminId, getSessionUserId } from "@/lib/auth";

// Статус имперсонации для баннера в кабинете владельца (docs/spec/
// 06-super-admin.md, п.4) — требует ОБА маркера сразу: маркер имперсонации
// сам по себе не должен пускать никого дальше, только вместе с валидной
// Owner-сессией (см. startImpersonation в src/lib/auth.ts).
export async function GET() {
  const adminId = await getImpersonatingAdminId();
  if (!adminId) {
    return NextResponse.json({ impersonating: false });
  }

  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ impersonating: false });
  }

  const owner = await prisma.user.findUnique({ where: { id: ownerId }, include: { tenant: true } });
  if (!owner || owner.role !== "owner" || !owner.tenant) {
    return NextResponse.json({ impersonating: false });
  }

  return NextResponse.json({ impersonating: true, tenantName: owner.tenant.name });
}
