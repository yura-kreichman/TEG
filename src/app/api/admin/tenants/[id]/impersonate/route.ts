import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { startImpersonation } from "@/lib/auth";

// Impersonate (docs/spec/06-super-admin.md, п.4) — временная сессия от имени
// первого Owner'а этого тенанта, редирект в кабинет владельца решает клиент.
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/tenants/[id]/impersonate">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const owner = await prisma.user.findFirst({
    where: { tenantId: id, role: "owner" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) {
    return NextResponse.json({ error: "У тенанта нет владельца" }, { status: 400 });
  }

  await startImpersonation(admin.user.id, owner.id);
  return NextResponse.json({ ok: true });
}
