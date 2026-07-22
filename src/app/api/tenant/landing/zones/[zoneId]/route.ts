import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { validateRichContent, extractPlainText, isRichContentEmpty } from "@/lib/rich-text";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { Prisma } from "@/generated/prisma/client";

// "Витринное" фото/подпись зоны (docs/spec/08-landing.md — решение
// 2026-07-13: у Zone нет собственного фото и не будет, только эта
// per-landing запись, создаётся лениво при первой правке конкретной зоны).
export async function PUT(request: Request, ctx: RouteContext<"/api/tenant/landing/zones/[zoneId]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "landingEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
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
  // caption — с 2026-07-13 ProseMirror/Tiptap JSON, тот же формат/белый
  // список, что aboutText (см. PATCH /api/tenant/landing) и Instruction.content
  // — см. src/lib/rich-text.ts.
  let captionValue: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined;
  if (caption !== undefined) {
    if (caption === null) {
      captionValue = Prisma.DbNull;
    } else {
      if (!validateRichContent(caption)) {
        return NextResponse.json({ error: "Некорректный формат подписи" }, { status: 400 });
      }
      if (extractPlainText(caption).length > 500) {
        return NextResponse.json({ error: "Слишком длинная подпись" }, { status: 400 });
      }
      captionValue = isRichContentEmpty(caption) ? Prisma.DbNull : (caption as unknown as Prisma.InputJsonValue);
    }
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
      caption: captionValue ?? Prisma.DbNull,
    },
    update: {
      ...(photoUrl !== undefined ? { photoUrl } : {}),
      ...(captionValue !== undefined ? { caption: captionValue } : {}),
    },
  });

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
