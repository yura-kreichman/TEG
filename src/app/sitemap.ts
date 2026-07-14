import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

// Должен жить в ИСТИННОМ корне app/ (не в route group) — тот же файловый
// конвеншен, что у favicon.ico/manifest.ts (Next.js резолвит sitemap.ts
// только на корневом уровне, докс/spec/08-landing.md, Шаг 6).
// force-dynamic, НЕ revalidate/ISR (найдено эмпирически 2026-07-13, реальный
// баг: ISR пытается статически сгенерировать /sitemap.xml во время `next
// build` в Docker-образе, а на этом этапе БД ещё недоступна — ECONNREFUSED,
// вся сборка падает). force-dynamic считает список публикаций на каждый
// запрос вместо кэша — для sitemap это приемлемо, краулеры заходят нечасто.
export const dynamic = "force-dynamic";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const published = await prisma.landing.findMany({
    where: { status: "published", tenant: { slug: { not: null } } },
    select: { updatedAt: true, tenant: { select: { slug: true } } },
  });

  return published
    .filter((l) => l.tenant.slug)
    .map((l) => ({
      url: `${SITE_URL}/s/${l.tenant.slug}`,
      lastModified: l.updatedAt,
      changeFrequency: "weekly" as const,
    }));
}
