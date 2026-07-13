import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

// Должен жить в ИСТИННОМ корне app/ (не в route group) — тот же файловый
// конвеншен, что у favicon.ico/manifest.ts (Next.js резолвит sitemap.ts
// только на корневом уровне, докс/spec/08-landing.md, Шаг 6). Кэшируется
// час (ниже) + точечно ревалидируется при publish/unpublish (см.
// src/app/api/tenant/landing/{publish,unpublish}/route.ts) — не критично
// для мгновенной точности, поисковики и так не переобходят сайт мгновенно.
export const revalidate = 3600;

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const published = await prisma.landing.findMany({
    where: { status: "published", tenant: { slug: { not: null } } },
    select: { updatedAt: true, tenant: { select: { slug: true } } },
  });

  return published
    .filter((l) => l.tenant.slug)
    .map((l) => ({
      url: `${SITE_URL}/site/${l.tenant.slug}`,
      lastModified: l.updatedAt,
      changeFrequency: "weekly" as const,
    }));
}
