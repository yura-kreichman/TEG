import { prisma } from "@/lib/prisma";
import { getDictionary } from "@/lib/i18n";
import { hasConfiguredHours, isOpenNow, findNextOpen, getTodayHours, type DayHours } from "@/lib/landing/opening-hours";
import { isRichContentEmpty, plainTextToDoc, type PMNode } from "@/lib/rich-text";

// Максимум активов в ленте внутри карточки зоны (докс, "Правила вёрстки",
// п.5а) — дальше тайл "+N ещё" вместо показа всех.
const MAX_FLEET_TILES = 12;

export interface LandingZonePointStatus {
  kind: "open" | "closed";
  time?: string;
  isTomorrow?: boolean;
  daysAhead?: number;
  weekday?: number;
}

export interface LandingRenderData {
  tenant: {
    name: string;
    locale: string;
    accentScheme: string;
    logoUrl: string | null;
    timezone: string;
  };
  slug: string;
  status: "draft" | "published";
  theme: "modern" | "classic" | "retro" | "festival" | "neon" | "pixel";
  effect: "none" | "snow" | "confetti" | "bubbles" | "leaves" | "sparks" | "petals" | "fireworks";
  tagline: string;
  aboutText: PMNode;
  galleryEnabled: boolean;
  ourFleetEnabled: boolean;
  showPrices: boolean;
  videoEnabled: boolean;
  videoYoutubeId: string | null;
  videoPoster: string | null;
  contacts: {
    phone: string | null;
    telegram: string | null;
    viber: string | null;
    whatsapp: string | null;
    instagram: string | null;
    facebook: string | null;
    tiktok: string | null;
    vk: string | null;
    ok: string | null;
    youtube: string | null;
  };
  metaTitleOverride: string | null;
  metaDescriptionOverride: string | null;
  googleSiteVerification: string | null;
  rulesInstruction: { slug: string; title: string } | null;
  galleryPhotos: { id: string; url: string }[];
  zones: Array<{
    id: string;
    name: string;
    iconKey: string | null;
    photoUrl: string | null;
    caption: PMNode | null;
    tariffs: { id: string; name: string; price: number }[];
    assetsCount: number;
    fleetAssets: { id: string; name: string; photoUrl: string }[];
    fleetOverflowCount: number;
    pointId: string;
    pointName: string;
    pointCity: string | null;
    pointIconKey: string | null;
  }>;
  points: Array<{
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    hoursNote: string | null;
    mapsUrl: string | null;
    openingHours: DayHours[];
    zoneNames: string[];
    hasLocationInfo: boolean;
    openStatus: LandingZonePointStatus | null;
  }>;
  primaryCity: string | null;
}

/**
 * Вся выборка для рендера публичной страницы (docs/spec/08-landing.md, Шаг
 * 4) — используется и опубликованной страницей (только status === "published"
 * проверяет вызывающий код), и превью-режимом (владелец видит черновик по
 * токену). Сама функция не проверяет статус/токен — это делает вызывающий
 * page.tsx, чтобы не дублировать бизнес-правило "кто что видит" здесь.
 */
export async function getLandingRenderData(tenantId: string): Promise<LandingRenderData | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true, locale: true, accentScheme: true, logoUrl: true, timezone: true },
  });
  if (!tenant?.slug) return null;

  const landing = await prisma.landing.findUnique({ where: { tenantId } });
  if (!landing) return null;

  const dict = getDictionary(tenant.locale);
  const lp = dict.landingPublic;

  const [points, galleryPhotos, zoneContents] = await Promise.all([
    // Деактивированные точки/зоны (докс: сезонность, решение пользователя
    // 2026-07-13) не показываются на Лендинге вообще — ни в "Где нас
    // найти", ни в "Прокат"/ленте активов их зон. Раньше здесь была реальная
    // утечка: Zone.active не фильтровался при сборе данных для Лендинга —
    // деактивированная зона всё равно отображалась посетителям как рабочая.
    prisma.point.findMany({
      where: { tenantId, active: true },
      orderBy: { createdAt: "asc" },
      include: {
        openingHours: { orderBy: { weekday: "asc" } },
        zones: {
          where: { active: true },
          orderBy: { createdAt: "asc" },
          include: {
            tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" } },
            assets: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    }),
    landing.galleryEnabled
      ? prisma.landingGalleryPhoto.findMany({ where: { landingId: landing.id }, orderBy: { sortOrder: "asc" } })
      : Promise.resolve([]),
    prisma.landingZoneContent.findMany({ where: { landingId: landing.id } }),
  ]);

  const zoneContentByZoneId = new Map(zoneContents.map((zc) => [zc.zoneId, zc]));
  const primaryCity = points.find((p) => p.city)?.city ?? null;

  const zones = points.flatMap((point) =>
    point.zones.map((zone) => {
      const content = zoneContentByZoneId.get(zone.id);
      // ПРАВИЛО ПУСТОТЫ (докс, "Правила вёрстки", п.7): нет текста владельца
      // — нет строки вообще, автогенерируемую подпись "{zone} — N единиц"
      // больше не подставляем.
      const captionDoc = (content?.caption as unknown as PMNode | null | undefined) ?? null;
      const caption = captionDoc && !isRichContentEmpty(captionDoc) ? captionDoc : null;

      const assetsWithPhoto = landing.ourFleetEnabled
        ? zone.assets.filter((a): a is typeof a & { photoUrl: string } => !!a.photoUrl)
        : [];
      const fleetAssets = assetsWithPhoto
        .slice(0, MAX_FLEET_TILES)
        .map((a) => ({ id: a.id, name: a.name, photoUrl: a.photoUrl }));
      const fleetOverflowCount = Math.max(0, assetsWithPhoto.length - MAX_FLEET_TILES);

      return {
        id: zone.id,
        name: zone.name,
        iconKey: zone.iconKey,
        photoUrl: content?.photoUrl ?? null,
        caption,
        tariffs: zone.tariffs.map((t) => ({ id: t.id, name: t.name, price: Number(t.price) })),
        assetsCount: zone.assets.length,
        fleetAssets,
        fleetOverflowCount,
        pointId: point.id,
        pointName: point.name,
        pointCity: point.city,
        pointIconKey: point.iconKey,
      };
    })
  );


  let rulesInstruction: { slug: string; title: string } | null = null;
  if (landing.rulesInstructionId) {
    // Если инструкцию сняли с публикации после привязки — блок молча не
    // рендерится (докс: не 500, не мёртвая ссылка), см. Шаг 2.
    const instruction = await prisma.instruction.findUnique({ where: { id: landing.rulesInstructionId } });
    if (instruction && instruction.status === "published") {
      rulesInstruction = { slug: instruction.slug, title: instruction.title };
    }
  }

  const tagline = landing.tagline ?? fillTemplate(lp, "title", tenant.name, primaryCity);
  const aboutTextDoc = (landing.aboutText as unknown as PMNode | null) ?? null;
  const aboutText =
    aboutTextDoc && !isRichContentEmpty(aboutTextDoc) ? aboutTextDoc : plainTextToDoc(fillTemplate(lp, "about", tenant.name, primaryCity));

  return {
    tenant: {
      name: tenant.name,
      locale: tenant.locale,
      accentScheme: tenant.accentScheme,
      logoUrl: tenant.logoUrl,
      timezone: tenant.timezone,
    },
    slug: tenant.slug,
    status: landing.status,
    theme: landing.theme,
    effect: landing.effect,
    tagline,
    aboutText,
    galleryEnabled: landing.galleryEnabled,
    ourFleetEnabled: landing.ourFleetEnabled,
    showPrices: landing.showPrices,
    videoEnabled: landing.videoEnabled,
    videoYoutubeId: landing.videoYoutubeId,
    videoPoster: landing.videoPoster,
    contacts: {
      phone: landing.contactPhone,
      telegram: landing.contactTelegram,
      viber: landing.contactViber,
      whatsapp: landing.contactWhatsapp,
      instagram: landing.contactInstagram,
      facebook: landing.contactFacebook,
      tiktok: landing.contactTiktok,
      vk: landing.contactVk,
      ok: landing.contactOk,
      youtube: landing.contactYoutube,
    },
    metaTitleOverride: landing.metaTitleOverride,
    metaDescriptionOverride: landing.metaDescriptionOverride,
    googleSiteVerification: landing.googleSiteVerification,
    rulesInstruction,
    galleryPhotos: galleryPhotos.map((p) => ({ id: p.id, url: p.url })),
    zones,
    points: points.map((p) => {
      // П.9/10: статус этой ТОЧКИ (не тенант-уровня "Сегодня работают") —
      // "Открыто" или ближайшее открытие; точка без адреса И часов не
      // рендерится в "Где нас найти" вообще (её зоны остаются в "Прокате").
      const open = isOpenNow(p.openingHours, tenant.timezone);
      let openStatus: LandingZonePointStatus | null = null;
      if (open === true) {
        // Запрос пользователя 2026-07-16: рядом с "Открыто" показывать "до
        // {время закрытия}" — до этого статус "открыто" не нёс времени вовсе.
        const today = getTodayHours(p.openingHours, tenant.timezone);
        openStatus = { kind: "open", time: today?.closesAt ?? undefined };
      } else if (open === false) {
        const next = findNextOpen(p.openingHours, tenant.timezone);
        if (next) {
          openStatus = { kind: "closed", time: next.time, isTomorrow: next.isTomorrow, daysAhead: next.daysAhead, weekday: next.weekday };
        }
      }
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        city: p.city,
        latitude: p.latitude,
        longitude: p.longitude,
        hoursNote: p.hoursNote,
        mapsUrl: p.mapsUrl,
        openingHours: p.openingHours,
        zoneNames: p.zones.map((z) => z.name),
        hasLocationInfo: !!p.address || hasConfiguredHours(p.openingHours),
        openStatus,
      };
    }),
    primaryCity,
  };
}

function fillTemplate(
  lp: ReturnType<typeof getDictionary>["landingPublic"],
  kind: "title" | "about",
  tenantName: string,
  city: string | null
): string {
  const template = city
    ? kind === "title"
      ? lp.titleTemplate
      : lp.defaultAbout
    : kind === "title"
      ? lp.titleTemplateNoCity
      : lp.defaultAboutNoCity;
  return template.replace("{tenantName}", tenantName).replace("{city}", city ?? "");
}
