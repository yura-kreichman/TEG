import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { isModuleEnabled } from "@/lib/tenant-modules";

const MAX_GALLERY_PHOTOS = 10; // докс: "5–10 фото владельца"

// Клиент сначала грузит файл через существующий POST /api/uploads
// (src/lib/uploads.ts — тот же механизм, что у фото активов/аватаров),
// затем присылает сюда только полученный url — второй upload-эндпоинт не
// заводим (докс, Шаг 2: "переиспользуй его, второй не создавай").
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "landingEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const landing = await prisma.landing.upsert({
    where: { tenantId: owner.tenantId },
    update: {},
    create: { tenantId: owner.tenantId },
  });

  const { url } = await request.json().catch(() => ({}));
  if (typeof url !== "string" || !url.startsWith(`/uploads/${owner.tenantId}/`)) {
    return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  }

  const count = await prisma.landingGalleryPhoto.count({ where: { landingId: landing.id } });
  if (count >= MAX_GALLERY_PHOTOS) {
    return NextResponse.json({ error: `Максимум ${MAX_GALLERY_PHOTOS} фото в галерее` }, { status: 409 });
  }

  const photo = await prisma.landingGalleryPhoto.create({
    data: { landingId: landing.id, url, sortOrder: count },
  });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ id: photo.id, url: photo.url, sortOrder: photo.sortOrder }, { status: 201 });
}
