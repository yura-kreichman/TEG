import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { isModuleEnabled } from "@/lib/tenant-modules";

export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "landingEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { slug: true } });
  if (!tenant?.slug) {
    return NextResponse.json({ error: "У тенанта ещё нет адреса — обратитесь в поддержку" }, { status: 409 });
  }

  const landing = await prisma.landing.findUnique({ where: { tenantId: owner.tenantId } });
  if (!landing) {
    return NextResponse.json({ error: "Сначала заполните раздел «Наполнение»" }, { status: 404 });
  }

  await prisma.landing.update({
    where: { id: landing.id },
    data: { status: "published", publishedAt: landing.publishedAt ?? new Date() },
  });
  await revalidateLandingForTenant(owner.tenantId);
  // Публикация меняет сам СПИСОК публичных URL — sitemap.xml тоже
  // ревалидируется точечно (не на каждую правку контента, только здесь и
  // при снятии с публикации, докс, Шаг 6).
  revalidatePath("/sitemap.xml");
  return NextResponse.json({ ok: true });
}
