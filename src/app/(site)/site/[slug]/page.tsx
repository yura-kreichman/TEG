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

// SITE_URL — статический env, НЕ headers()/cookies() (докс, Шаг 4: должен
// оставаться SSG). См. .env / .env.production.example.
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

async function loadPublishedData(slug: string): Promise<LandingRenderData | null> {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return null;
  const data = await getLandingRenderData(tenant.id);
  if (!data || data.status !== "published") return null;
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadPublishedData(slug);
  if (!data) return {};

  const canonical = `${SITE_URL}/site/${data.slug}`;
  const title = data.metaTitleOverride ?? data.tagline;
  const description = (data.metaDescriptionOverride ?? data.aboutText).slice(0, 160);
  const ogImageRelative = data.galleryPhotos[0]?.url ?? data.zones.find((z) => z.photoUrl)?.photoUrl ?? null;
  const ogImage = ogImageRelative ? `${SITE_URL}${ogImageRelative}` : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    // Опубликованный лендинг всегда индексируется, опции "скрыть из поиска"
    // нет (докс, "Жизненный цикл") — явный robots:true, не полагаемся на
    // дефолт (превью-роут ниже явно переопределяет на noindex).
    robots: { index: true, follow: true },
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

export default async function PublicLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadPublishedData(slug);
  if (!data) notFound();

  const dict = getDictionary(data.tenant.locale);
  const lp = dict.landingPublic;
  const weekdayNames = dict.readings.weekdaysFull;
  // Лайтбокс грузится только если реально есть что открывать (докс: ноль
  // лишнего JS, тот же принцип, что и условный video-скрипт ниже).
  const needsLightbox = data.galleryPhotos.length > 0 || data.zones.some((z) => z.photoUrl || z.fleetAssets.length > 0);

  return (
    <>
      <LandingJsonLd data={data} baseUrl={SITE_URL} />
      <div className="flex flex-col">
        {/* Порядок секций (докс, "Правила вёрстки", п.3): герой → галерея →
            видео → "О нас" → Прокат → Контакты (точки + телефон/соцсети,
            без отдельного заголовка "Где нас найти" — решение пользователя
            2026-07-13) → Правила → футер. */}
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
