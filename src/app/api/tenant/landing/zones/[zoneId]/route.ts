import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

// "Витринное" фото/подпись зоны (docs/spec/08-landing.md — решение
// 2026-07-13: у Zone нет собственного фото и не будет, только эта
// per-landing запись, создаётся лениво при первой правке конкретной зоны).
export async function PUT(request: Request, ctx: RouteContext<"/api/tenant/landing/zones/[zoneId]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const landing = await prisma.landing.upsert({
    where: { tenantId: owner.tenantId },
    update: {},
    create: { tenantId: owner.tenantId },
  });

  const { photoUrl, caption } = await request.json().catch(() => ({}));
  if (photoUrl !== undefined && photoUrl !== null && typeof photoUrl === "string" && !photoUrl.startsWith(`/uploads/${owner.tenantId}/`)) {
    return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  }
  if (caption !== undefined && caption !== null && (typeof caption !== "string" || caption.length > 500)) {
    return NextResponse.json({ error: "Слишком длинная подпись" }, { status: 400 });
  }

  const existing = await prisma.landingZoneContent.findUnique({ where: { zoneId } });
  if (photoUrl !== undefined && existing?.photoUrl && existing.photoUrl !== photoUrl) {
    await deleteUploadedImage(existing.photoUrl);
  }

  await prisma.landingZoneContent.upsert({
    where: { zoneId },
    create: {
      landingId: landing.id,
      zoneId,
      photoUrl: photoUrl === undefined ? null : photoUrl,
      caption: caption === undefined ? null : caption?.trim() || null,
    },
    update: {
      ...(photoUrl !== undefined ? { photoUrl } : {}),
      ...(caption !== undefined ? { caption: caption?.trim() || null } : {}),
    },
  });

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
