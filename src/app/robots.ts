import type { MetadataRoute } from "next";

// Должен жить в ИСТИННОМ корне app/ (докс/spec/08-landing.md, Шаг 6) — тот
// же файловый конвеншен, что у sitemap.ts/favicon.ico/manifest.ts.
// Приложение (кабинет владельца, PWA оператора, API) не предназначено для
// индексации вообще — публична только /site/{slug}, и то не её превью-ветка.
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/site/",
      disallow: ["/", "/site/*/preview/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
