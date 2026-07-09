import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { validatePackagePayload } from "@/lib/packages";

export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/packages/[id]">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const pkg = await prisma.package.findUnique({ where: { id } });
  if (!pkg) {
    return NextResponse.json({ error: "Пакет не найден" }, { status: 404 });
  }

  const payload = validatePackagePayload(await request.json());
  if (!payload) {
    return NextResponse.json({ error: "Некорректные данные пакета" }, { status: 400 });
  }

  await prisma.package.update({ where: { id }, data: payload });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/packages/[id]">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const pkg = await prisma.package.findUnique({ where: { id }, include: { _count: { select: { tenants: true } } } });
  if (!pkg) {
    return NextResponse.json({ error: "Пакет не найден" }, { status: 404 });
  }
  if (pkg._count.tenants > 0) {
    return NextResponse.json(
      { error: `Пакет использует ${pkg._count.tenants} владельцев — сначала переведите их на другой пакет` },
      { status: 409 }
    );
  }

  await prisma.package.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
