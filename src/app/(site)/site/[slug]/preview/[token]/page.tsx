import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLandingRenderData, type LandingRenderData } from "@/lib/landing/get-render-data";
import { getDictionary } from "@/lib/i18n";
import { LandingJsonLd } from "@/components/landing/json-ld";
import {
  Header,
  GallerySection,
  VideoSection,
  AboutSection,
  RentalSection,
  ContactsSection,
  RulesSection,
  LandingFooter,
  LandingEffectLoader,
  LightboxSkeleton,
  SectionDivider,
} from "@/components/landing/sections";

// Превью по секретной ссылке (docs/spec/08-landing.md, "Жизненный цикл") —
// токен ЖИВЁТ В ПУТИ, не в query (?preview=...): searchParams в Server
// Component форсируют динамический рендер всего маршрута, а токен в пути —
// отдельный роут, который просто ВСЕГДА динамический (и должен быть: здесь
// нужны самые свежие данные черновика сразу после правки владельцем, без
// ожидания ревалидации). Основной /site/[slug] остаётся статическим SSG.
export const dynamic = "force-dynamic";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

async function loadPreviewData(slug: string, token: string): Promise<LandingRenderData | null> {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return null;
  const landing = await prisma.landing.findUnique({ where: { tenantId: tenant.id }, select: { previewToken: true } });
  if (!landing || landing.previewToken !== token) return null;
  return getLandingRenderData(tenant.id);
}

// Всегда noindex + disallow (докс: "недоступна без токена", "превью — noindex").
export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false, follow: false } };
}

export default async function LandingPreviewPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const data = await loadPreviewData(slug, token);
  if (!data) notFound();

  const dict = getDictionary(data.tenant.locale);
  const lp = dict.landingPublic;
  const weekdayNames = dict.readings.weekdaysFull;
  const needsLightbox = data.galleryPhotos.length > 0 || data.zones.some((z) => z.photoUrl || z.fleetAssets.length > 0);

  return (
    <>
      <div className="sticky top-0 z-50 bg-foreground px-4 py-2 text-center text-sm font-semibold text-background">
        {lp.previewBadge}
      </div>
      <LandingJsonLd data={data} baseUrl={SITE_URL} />
      <div className="flex flex-col">
        <Header data={data} lp={lp} />
        <GallerySection data={data} />
        <VideoSection data={data} lp={lp} />
        <AboutSection data={data} />
        <SectionDivider />
        <RentalSection data={data} lp={lp} />
        <SectionDivider />
        <ContactsSection data={data} lp={lp} weekdayNames={weekdayNames} />
        <RulesSection data={data} lp={lp} />
        <LandingFooter data={data} lp={lp} />
      </div>
      {needsLightbox && <LightboxSkeleton lp={lp} />}
      <script src="/landing-share.js" defer />
      {data.videoEnabled && data.videoYoutubeId && <script src="/landing-video.js" defer />}
      {needsLightbox && <script src="/landing-lightbox.js" defer />}
      <LandingEffectLoader effect={data.effect} />
    </>
  );
}
