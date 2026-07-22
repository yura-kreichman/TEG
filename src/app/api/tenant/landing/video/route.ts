import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { deleteUploadedImage, saveRemoteImageAsWebp } from "@/lib/uploads";
import { parseYoutubeId, fetchYoutubeThumbnail } from "@/lib/landing/youtube";
import { isModuleEnabled } from "@/lib/tenant-modules";

// docs/spec/08-landing.md, "Секция видео" — фасад: ID парсится и обложка
// скачивается/валидируется ЗДЕСЬ, при сохранении в кабинете, не на публичной
// странице (которая только читает уже сохранённые videoYoutubeId/videoPoster
// из БД — ноль обращений к YouTube с публичного маршрута).
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "landingEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { url } = await request.json().catch(() => ({}));
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Вставьте ссылку на видео" }, { status: 400 });
  }

  const videoId = parseYoutubeId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Не удалось распознать ссылку YouTube" }, { status: 400 });
  }

  const thumbnail = await fetchYoutubeThumbnail(videoId);
  if (!thumbnail) {
    return NextResponse.json({ error: "Видео с таким адресом не найдено на YouTube" }, { status: 400 });
  }

  const landing = await prisma.landing.upsert({
    where: { tenantId: owner.tenantId },
    update: {},
    create: { tenantId: owner.tenantId },
  });

  const posterUrl = await saveRemoteImageAsWebp(owner.tenantId, thumbnail);
  if (landing.videoPoster) {
    await deleteUploadedImage(landing.videoPoster);
  }

  await prisma.landing.update({
    where: { id: landing.id },
    data: { videoYoutubeId: videoId, videoPoster: posterUrl, videoEnabled: true },
  });

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ videoYoutubeId: videoId, videoPoster: posterUrl });
}

export async function DELETE() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "landingEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const landing = await prisma.landing.findUnique({ where: { tenantId: owner.tenantId } });
  if (!landing) {
    return NextResponse.json({ error: "Лендинг не найден" }, { status: 404 });
  }

  if (landing.videoPoster) {
    await deleteUploadedImage(landing.videoPoster);
  }

  await prisma.landing.update({
    where: { id: landing.id },
    data: { videoYoutubeId: null, videoPoster: null, videoEnabled: false },
  });

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
