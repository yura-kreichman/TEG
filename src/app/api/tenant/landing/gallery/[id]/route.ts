import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { isModuleEnabled } from "@/lib/tenant-modules";

async function findOwnedPhoto(tenantId: string, id: string) {
  const photo = await prisma.landingGalleryPhoto.findUnique({ where: { id }, include: { landing: true } });
  if (!photo || photo.landing.tenantId !== tenantId) return null;
  return photo;
}

// Drag-and-drop порядок (докс) — клиент присылает новый sortOrder, простое
// присвоение достаточно (не обмен местами, как у Asset.sortOrder — здесь
// список маленький, до 10 штук, и всегда переупорядочивается целиком).
export async function PATCH(request: Request, ctx: RouteContext<"/api/tenant/landing/gallery/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "landingEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const photo = await findOwnedPhoto(owner.tenantId, id);
  if (!photo) {
    return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  }

  const { sortOrder } = await request.json().catch(() => ({}));
  if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) || sortOrder < 0) {
    return NextResponse.json({ error: "Некорректный порядок" }, { status: 400 });
  }

  await prisma.landingGalleryPhoto.update({ where: { id }, data: { sortOrder } });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/tenant/landing/gallery/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "landingEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const photo = await findOwnedPhoto(owner.tenantId, id);
  if (!photo) {
    return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  }

  await prisma.landingGalleryPhoto.delete({ where: { id } });
  await deleteUploadedImage(photo.url);
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
