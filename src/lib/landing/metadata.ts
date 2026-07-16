import type { Metadata } from "next";
import type { LandingRenderData } from "@/lib/landing/get-render-data";
import { extractPlainText } from "@/lib/rich-text";

// Общая сборка <title>/description/OG/Twitter для обеих публичных страниц
// Лендинга (/s/[slug] и .../preview/[token]) — до 2026-07-14 превью-роут
// задавал только robots: {index:false}, без title/description вообще, из-за
// чего вкладка браузера на превью показывала голый URL вместо названия
// (найдено пользователем). canonical у обеих — всегда ОПУБЛИКОВАННЫЙ URL, не
// секретная ссылка превью — превью не должно становиться каноническим
// адресом даже случайно. Путь /s/ (не /site/) — решение пользователя
// 2026-07-14, старый префикс редиректит 301 (next.config.ts redirects()).
export function buildLandingMetadata(
  data: LandingRenderData,
  siteUrl: string,
  robots: { index: boolean; follow: boolean }
): Metadata {
  const canonical = `${siteUrl}/s/${data.slug}`;
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
    // Код подтверждения владения сайтом — Next.js сам рендерит
    // <meta name="google-site-verification" content="..."> (решение
    // пользователя 2026-07-14: домен my.rentos365.app тенанту не
    // принадлежит, DNS-верификация недоступна, но верификация ПО URL через
    // HTML-тег в <head> работает и без владения доменом целиком — тот же
    // паттерн, что у Wix/Squarespace/Shopify). Яндекс.Вебмастер убран
    // 2026-07-16 — не поддерживает верификацию по HTML-тегу для сайта в
    // подпапке, только Google Search Console.
    verification: data.googleSiteVerification ? { google: data.googleSiteVerification } : undefined,
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
