import path from "path";
import type { Metadata } from "next";
import sharp from "sharp";
import type { LandingRenderData } from "@/lib/landing/get-render-data";
import { OG_LOCALES, isLocale } from "@/lib/locales";
import { extractPlainText } from "@/lib/rich-text";

// Реальные размеры OG-картинки. До 2026-08-15 здесь стояли зашитые 1200x630
// из спеки — но приводить загруженное фото к этому размеру никто не приводит
// (src/lib/uploads.ts переводит в WebP и только), и у КидсБурга под видом
// 1200x630 уезжало фото 1280x720. Соцсети по этой подсказке резервируют
// место под превью, так что враньё выходит боком именно там, ради чего
// подсказка и нужна. Читаем заголовок файла — sharp разбирает только его,
// пиксели не декодируются; страница статическая, так что это делается раз на
// ревалидацию, а не на посетителя.
async function measureUploadedImage(relativeUrl: string): Promise<{ width: number; height: number } | null> {
  // Только собственные загрузки и без выхода вверх по дереву: значение
  // приходит из базы, но путь всё равно собирается из него — проверка
  // дешевле, чем разбираться потом.
  if (!relativeUrl.startsWith("/uploads/") || relativeUrl.includes("..")) return null;
  try {
    const meta = await sharp(path.join(process.cwd(), "public", relativeUrl)).metadata();
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
  } catch {
    // Файла нет или он битый — карточка просто останется без подсказки о
    // размерах, это лучше, чем уронить генерацию метаданных всей страницы.
    return null;
  }
}

// Общая сборка <title>/description/OG/Twitter для обеих публичных страниц
// Лендинга (/s/[slug] и .../preview/[token]) — до 2026-07-14 превью-роут
// задавал только robots: {index:false}, без title/description вообще, из-за
// чего вкладка браузера на превью показывала голый URL вместо названия
// (найдено пользователем). canonical у обеих — всегда ОПУБЛИКОВАННЫЙ URL, не
// секретная ссылка превью — превью не должно становиться каноническим
// адресом даже случайно. Путь /s/ (не /site/) — решение пользователя
// 2026-07-14, старый префикс редиректит 301 (next.config.ts redirects()).
export async function buildLandingMetadata(
  data: LandingRenderData,
  siteUrl: string,
  robots: { index: boolean; follow: boolean }
): Promise<Metadata> {
  const canonical = `${siteUrl}/s/${data.slug}`;
  const title = data.metaTitleOverride ?? data.tagline;
  const description = (data.metaDescriptionOverride ?? extractPlainText(data.aboutText)).slice(0, 160);
  const ogImageRelative = data.galleryPhotos[0]?.url ?? data.zones.find((z) => z.photoUrl)?.photoUrl ?? null;
  const ogImage = ogImageRelative ? `${siteUrl}${ogImageRelative}` : undefined;
  const ogImageSize = ogImageRelative ? await measureUploadedImage(ogImageRelative) : null;
  // Подпись к картинке репоста описывает саму картинку, а не страницу:
  // название бизнеса и город — то же, из чего собран alt витринных фото.
  const ogImageAlt = data.primaryCity ? `${data.tenant.name} — ${data.primaryCity}` : data.tenant.name;

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
      // Имя площадки в карточке репоста — бизнес тенанта, а не RentOS:
      // страница представляет его, платформа тут ни при чём.
      siteName: data.tenant.name,
      title,
      description,
      url: canonical,
      locale: isLocale(data.tenant.locale) ? OG_LOCALES[data.tenant.locale] : undefined,
      images: ogImage ? [{ url: ogImage, alt: ogImageAlt, ...(ogImageSize ?? {}) }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      // Объектом, а не массивом из одного элемента: в форме массива этот Next
      // не выводит twitter:image:alt вовсе (проверено на живой странице),
      // а документированный пример (generate-metadata.md) — именно объект.
      images: ogImage ? { url: ogImage, alt: ogImageAlt } : undefined,
    },
  };
}
