import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { name: true, logoUrl: true },
  });

  return NextResponse.json({ name: tenant?.name ?? "", logoUrl: tenant?.logoUrl ?? null });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { name, logoUrl } = await request.json();
  const data: { name?: string; logoUrl?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название компании обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }

  if (logoUrl !== undefined) {
    const nextLogoUrl = typeof logoUrl === "string" && logoUrl.trim() ? logoUrl.trim() : null;
    const current = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { logoUrl: true } });
    if (current?.logoUrl && current.logoUrl !== nextLogoUrl) {
      await deleteUploadedImage(current.logoUrl);
    }
    data.logoUrl = nextLogoUrl;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего сохранять" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  return NextResponse.json({ ok: true });
}
