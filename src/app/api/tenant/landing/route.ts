import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import type { Prisma } from "@/generated/prisma/client";

// Лендинг — 1:1 с тенантом (docs/spec/08-landing.md), но не создаётся при
// регистрации тенанта (модуль подключён позже большинства тенантов) —
// ленивое создание при первом обращении к разделу "Лендинг" в кабинете.
async function getOrCreateLanding(tenantId: string) {
  const existing = await prisma.landing.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.landing.create({ data: { tenantId } });
}

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const [landing, tenant] = await Promise.all([
    getOrCreateLanding(owner.tenantId),
    prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { slug: true, name: true } }),
  ]);

  const [galleryPhotos, zoneContents] = await Promise.all([
    prisma.landingGalleryPhoto.findMany({ where: { landingId: landing.id }, orderBy: { sortOrder: "asc" } }),
    prisma.landingZoneContent.findMany({ where: { landingId: landing.id } }),
  ]);

  return NextResponse.json({ ...landing, slug: tenant?.slug ?? null, tenantName: tenant?.name ?? "", galleryPhotos, zoneContents });
}

const SOCIAL_FIELDS = [
  "contactPhone",
  "contactTelegram",
  "contactViber",
  "contactWhatsapp",
  "contactInstagram",
  "contactFacebook",
  "contactTiktok",
  "contactVk",
  "contactOk",
  "contactYoutube",
] as const;

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const landing = await getOrCreateLanding(owner.tenantId);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  // Слаг здесь НЕ редактируется (решение пользователя 2026-07-13) — только
  // вместе со сменой названия компании, см. PATCH /api/tenant/profile.
  const {
    tagline,
    aboutText,
    galleryEnabled,
    ourFleetEnabled,
    showPrices,
    videoEnabled,
    theme,
    effect,
    rulesInstructionId,
    metaTitleOverride,
    metaDescriptionOverride,
    ...rest
  } = body as Record<string, unknown>;

  const data: Prisma.LandingUpdateInput = {};

  const THEMES = ["modern", "classic", "retro", "festival", "neon", "pixel"] as const;
  const EFFECTS = ["none", "snow", "confetti", "bubbles", "leaves", "sparks", "petals", "fireworks"] as const;
  if (theme !== undefined) {
    if (typeof theme !== "string" || !THEMES.includes(theme as (typeof THEMES)[number])) {
      return NextResponse.json({ error: "Некорректная тема" }, { status: 400 });
    }
    data.theme = theme as (typeof THEMES)[number];
  }
  if (effect !== undefined) {
    if (typeof effect !== "string" || !EFFECTS.includes(effect as (typeof EFFECTS)[number])) {
      return NextResponse.json({ error: "Некорректный эффект" }, { status: 400 });
    }
    data.effect = effect as (typeof EFFECTS)[number];
  }

  // Текстовые поля — plain text, санитизация происходит при выводе
  // (экранирование React-узлов, докс: "БЕЗ rich-редактора"), здесь только
  // ограничение длины против абьюза формы.
  if (tagline !== undefined) {
    if (tagline !== null && (typeof tagline !== "string" || tagline.length > 200)) {
      return NextResponse.json({ error: "Слишком длинный слоган" }, { status: 400 });
    }
    data.tagline = tagline === null ? null : tagline.trim() || null;
  }
  if (aboutText !== undefined) {
    if (aboutText !== null && (typeof aboutText !== "string" || aboutText.length > 4000)) {
      return NextResponse.json({ error: "Слишком длинный текст «О нас»" }, { status: 400 });
    }
    data.aboutText = aboutText === null ? null : aboutText.trim() || null;
  }
  if (galleryEnabled !== undefined) {
    if (typeof galleryEnabled !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.galleryEnabled = galleryEnabled;
  }
  if (showPrices !== undefined) {
    if (typeof showPrices !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.showPrices = showPrices;
  }
  if (ourFleetEnabled !== undefined) {
    if (typeof ourFleetEnabled !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    if (ourFleetEnabled) {
      // "Если ни у одного актива нет фото — секция недоступна для
      // включения" (докс, "Живые секции и фишки").
      const assetsWithPhoto = await prisma.asset.count({
        where: { zone: { point: { tenantId: owner.tenantId } }, photoUrl: { not: null } },
      });
      if (assetsWithPhoto === 0) {
        return NextResponse.json({ error: "Нет ни одного актива с фото — сначала загрузите фото активов" }, { status: 409 });
      }
    }
    data.ourFleetEnabled = ourFleetEnabled;
  }
  if (videoEnabled !== undefined) {
    if (typeof videoEnabled !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    // Переключатель только скрывает/показывает уже сохранённое видео (докс,
    // Шаг 6: "переключатель секции" и "Удалить видео" — два разных элемента
    // управления) — ссылку/обложку он не трогает, поэтому включить нечего,
    // если видео ещё не задано через POST /api/tenant/landing/video.
    const currentLanding = await prisma.landing.findUnique({ where: { tenantId: owner.tenantId } });
    if (videoEnabled && !currentLanding?.videoYoutubeId) {
      return NextResponse.json({ error: "Сначала добавьте ссылку на видео" }, { status: 409 });
    }
    data.videoEnabled = videoEnabled;
  }
  if (metaTitleOverride !== undefined) {
    if (metaTitleOverride !== null && (typeof metaTitleOverride !== "string" || metaTitleOverride.length > 70)) {
      return NextResponse.json({ error: "Слишком длинный title" }, { status: 400 });
    }
    data.metaTitleOverride = metaTitleOverride === null ? null : metaTitleOverride.trim() || null;
  }
  if (metaDescriptionOverride !== undefined) {
    if (metaDescriptionOverride !== null && (typeof metaDescriptionOverride !== "string" || metaDescriptionOverride.length > 200)) {
      return NextResponse.json({ error: "Слишком длинное description" }, { status: 400 });
    }
    data.metaDescriptionOverride = metaDescriptionOverride === null ? null : metaDescriptionOverride.trim() || null;
  }
  if (rulesInstructionId !== undefined) {
    if (rulesInstructionId === null) {
      data.rulesInstruction = { disconnect: true };
    } else {
      if (typeof rulesInstructionId !== "string") {
        return NextResponse.json({ error: "Некорректная инструкция" }, { status: 400 });
      }
      const instruction = await prisma.instruction.findUnique({ where: { id: rulesInstructionId } });
      if (!instruction || instruction.tenantId !== owner.tenantId || instruction.status !== "published") {
        return NextResponse.json({ error: "Инструкция должна быть опубликована" }, { status: 400 });
      }
      data.rulesInstruction = { connect: { id: rulesInstructionId } };
    }
  }
  for (const field of SOCIAL_FIELDS) {
    const value = rest[field];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || value.length > 200)) {
      return NextResponse.json({ error: `Некорректное значение поля ${field}` }, { status: 400 });
    }
    (data as Record<string, unknown>)[field] = value === null ? null : value.trim() || null;
  }

  if (Object.keys(data).length > 0) {
    await prisma.landing.update({ where: { id: landing.id }, data });
  }

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
