import type { LandingRenderData } from "@/lib/landing/get-render-data";
import { contactHref } from "@/lib/landing/contact-links";

const WEEKDAY_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// JSON-LD (docs/spec/08-landing.md, SEO): LocalBusiness на каждую точку, БЕЗ
// priceRange (валюта в системе не ведётся), sameAs на заполненные соцсети,
// ImageObject для витринных фото зон. Один <script type="application/ld+json">
// с @graph — валиднее и легче парсить валидатору, чем несколько тегов.
export function LandingJsonLd({ data, baseUrl }: { data: LandingRenderData; baseUrl: string }) {
  const sameAs = (["telegram", "instagram", "facebook", "tiktok", "whatsapp", "viber"] as const)
    .map((kind) => (data.contacts[kind] ? contactHref(kind, data.contacts[kind]!) : null))
    .filter((v): v is string => !!v);

  const localBusinesses = data.points.map((point) => ({
    "@type": "LocalBusiness",
    name: `${data.tenant.name} — ${point.name}`,
    url: baseUrl,
    ...(point.address ? { address: { "@type": "PostalAddress", streetAddress: point.address, addressLocality: point.city ?? undefined } } : {}),
    ...(point.latitude != null && point.longitude != null
      ? { geo: { "@type": "GeoCoordinates", latitude: point.latitude, longitude: point.longitude } }
      : {}),
    ...(point.mapsUrl ? { hasMap: point.mapsUrl } : {}),
    ...(data.contacts.phone ? { telephone: data.contacts.phone } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(point.openingHours.some((h) => h.isOpen)
      ? {
          openingHoursSpecification: point.openingHours
            .filter((h) => h.isOpen && h.opensAt && h.closesAt)
            .map((h) => ({
              "@type": "OpeningHoursSpecification",
              dayOfWeek: `https://schema.org/${WEEKDAY_EN[h.weekday]}`,
              opens: h.opensAt,
              closes: h.closesAt,
            })),
        }
      : {}),
  }));

  const images = data.zones
    .filter((z) => z.photoUrl)
    .map((z) => ({
      "@type": "ImageObject",
      contentUrl: `${baseUrl}${z.photoUrl}`,
      name: `${z.name} — ${data.tenant.name}`,
    }));

  const jsonLd = { "@context": "https://schema.org", "@graph": [...localBusinesses, ...images] };

  // JSON-LD, не HTML — значения либо структурные числа/URL, либо экранируются JSON.stringify.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />;
}
