import type { Metadata } from "next";
import type { LandingRenderData } from "@/lib/landing/get-render-data";
import { extractPlainText } from "@/lib/rich-text";

// Общая сборка <title>/description/OG/Twitter для обеих публичных страниц
// Лендинга (/site/[slug] и .../preview/[token]) — до 2026-07-14 превью-роут
// задавал только robots: {index:false}, без title/description вообще, из-за
// чего вкладка браузера на превью показывала голый URL вместо названия
// (найдено пользователем). canonical у обеих — всегда ОПУБЛИКОВАННЫЙ URL, не
// секретная ссылка превью — превью не должно становиться каноническим
// адресом даже случайно.
export function buildLandingMetadata(
  data: LandingRenderData,
  siteUrl: string,
  robots: { index: boolean; follow: boolean }
): Metadata {
  const canonical = `${siteUrl}/site/${data.slug}`;
  const title = data.metaTitleOverride ?? data.tagline;
  const description = (data.metaDescriptionOverride ?? extractPlainText(data.aboutText)).slice(0, 160);
  const ogImageRelative = data.galleryPhotos[0]?.url ?? data.zones.find((z) => z.photoUrl)?.photoUrl ?? null;
  const ogImage = ogImageRelative ? `${siteUrl}${ogImageRelative}` : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    robots,
    // Логотип тенанта как favicon этой страницы — не платформенный RentOS,
    // иначе делится бы одной иконкой из корня приложения (src/app/favicon.ico)
    // на всех тенантов. Google и другие поисковики подставляют favicon рядом
    // со сниппетом в выдаче (решение пользователя 2026-07-14: "добавь
    // логотип компании в Google Preview и других поисковиков").
    icons: data.tenant.logoUrl ? { icon: data.tenant.logoUrl } : undefined,
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      locale: data.tenant.locale,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}
