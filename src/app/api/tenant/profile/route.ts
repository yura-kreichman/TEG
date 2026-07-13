import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { generateUniqueSlug } from "@/lib/instructions/slug";
import { isReservedSlug, isSlugTaken } from "@/lib/landing/slug";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { name: true, logoUrl: true, slug: true },
  });

  return NextResponse.json({ name: tenant?.name ?? "", logoUrl: tenant?.logoUrl ?? null, slug: tenant?.slug ?? null });
}

// Слаг (docs/spec/08-landing.md, "/i/" и "/site/") меняется ИМЕННО здесь —
// вместе со сменой названия компании (решение пользователя 2026-07-13,
// отменяет более раннее решение "редактируется в разделе Лендинг"), а не
// отдельным полем в настройках Лендинга. Владелец явно включает updateSlug —
// смена не автоматическая, старые ссылки (QR на точке и т.п.) перестанут
// вести напрямую (301 на новый адрес через TenantOldSlug).
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { name, logoUrl, updateSlug } = await request.json();
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

  let newSlug: string | null = null;
  if (data.name && updateSlug === true) {
    const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { slug: true } });
    newSlug = await generateUniqueSlug(data.name, async (candidate) => {
      if (isReservedSlug(candidate)) return true;
      return isSlugTaken(candidate, owner.tenantId);
    });
    if (newSlug !== tenant?.slug) {
      await prisma.$transaction([
        ...(tenant?.slug ? [prisma.tenantOldSlug.create({ data: { tenantId: owner.tenantId, slug: tenant.slug } })] : []),
        // Реклейм собственного старого адреса (найдено Шагом 7 живым тестом):
        // если newSlug — это чей-то из СВОИХ прежних слагов, убираем его из
        // TenantOldSlug — иначе там останется бессмысленная запись "слаг X
        // редиректит на слаг X, который есть текущий".
        prisma.tenantOldSlug.deleteMany({ where: { tenantId: owner.tenantId, slug: newSlug } }),
        prisma.tenant.update({ where: { id: owner.tenantId }, data: { ...data, slug: newSlug } }),
      ]);
      await revalidateLandingForTenant(owner.tenantId);
      return NextResponse.json({ ok: true, slug: newSlug });
    }
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  return NextResponse.json({ ok: true, slug: newSlug });
}
