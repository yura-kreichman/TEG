import type { LandingRenderData } from "@/lib/landing/get-render-data";
import { contactHref } from "@/lib/landing/contact-links";
import { extractPlainText } from "@/lib/rich-text";

const WEEKDAY_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// JSON-LD (docs/spec/08-landing.md, SEO): LocalBusiness на каждую точку, БЕЗ
// priceRange (валюта в системе не ведётся), sameAs на заполненные соцсети,
// ImageObject для витринных фото зон. Один <script type="application/ld+json">
// с @graph — валиднее и легче парсить валидатору, чем несколько тегов.
export function LandingJsonLd({ data, baseUrl }: { data: LandingRenderData; baseUrl: string }) {
  // Канонический URL страницы, не корень домена — LocalBusiness.url должен
  // указывать на собственную страницу бизнеса (найдено при аудите SEO
  // 2026-07-14, была ошибка: url: baseUrl без пути).
  const canonicalUrl = `${baseUrl}/s/${data.slug}`;
  const logoUrl = data.tenant.logoUrl ? `${baseUrl}${data.tenant.logoUrl}` : null;
  // Все соцсети, которые контакты вообще поддерживают (ContactKind минус
  // "phone" — телефон не соцсеть) — раньше vk/ok/youtube были пропущены
  // (добавлены в контакты позже, sameAs не обновили; аудит 2026-07-24):
  // на странице кнопка есть, а в структурированных данных канала не было.
  const sameAs = (
    ["telegram", "instagram", "facebook", "tiktok", "whatsapp", "viber", "vk", "ok", "youtube"] as const
  )
    .map((kind) => (data.contacts[kind] ? contactHref(kind, data.contacts[kind]!) : null))
    .filter((v): v is string => !!v);

  // Идентификаторы узлов графа. Без них поисковик видит несколько разрозненных
  // сущностей и сам гадает, одна это компания или разные; со ссылками @id —
  // читает связный граф "сайт → страница → компания → точки → фотографии".
  const ORG_ID = `${canonicalUrl}#organization`;
  const SITE_ID = `${canonicalUrl}#website`;
  const PAGE_ID = `${canonicalUrl}#webpage`;
  const LOGO_ID = `${canonicalUrl}#logo`;
  const photoId = (id: string) => `${canonicalUrl}#photo-${id}`;

  // Описание компании для графа — тот же текст, что уходит в мета-описание
  // страницы: короткая выжимка «О нас». Обрезка по той же границе, чтобы в
  // разметке и в сниппете не расходились формулировки.
  const description = (data.metaDescriptionOverride ?? extractPlainText(data.aboutText)).slice(0, 160) || null;

  // Фотографии для выдачи: сначала галерея (главные снимки, владелец сам
  // ставит их порядок), следом витринные фото зон. До 2026-08-15 в
  // структурированные данные попадали ТОЛЬКО фото зон, а галерея — самое
  // содержательное, что есть на странице — не попадала вовсе. Потолок в 12
  // штук: Google больше одной-двух в сниппете не показывает, а вес разметки
  // растёт линейно.
  const MAX_PHOTOS = 12;
  const photos = [
    ...data.galleryPhotos.map((p) => ({ id: p.id, url: p.url, name: `${data.tenant.name}${data.primaryCity ? ` — ${data.primaryCity}` : ""}` })),
    ...data.zones.filter((z) => z.photoUrl).map((z) => ({ id: z.id, url: z.photoUrl!, name: `${z.name} — ${data.tenant.name}` })),
  ].slice(0, MAX_PHOTOS);
  const photoUrls = photos.map((p) => `${baseUrl}${p.url}`);

  // Organization.logo — стандартный способ подсказать Google/другим
  // поисковикам логотип компании для сниппета/Knowledge Panel (решение
  // пользователя 2026-07-14: "добавь логотип компании в Google Preview").
  // Само наличие этих данных не гарантирует показ — Google решает по
  // многим факторам (включая доверие/возраст сайта, верификация через
  // Search Console), но это необходимое структурное условие.
  const organization = [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: data.tenant.name,
      url: canonicalUrl,
      // Логотип отдельным узлом ImageObject, а не голой строкой — так его
      // можно переиспользовать ссылкой и так его подают современные
      // генераторы разметки. Требования Google к этой картинке (не меньше
      // 112x112, доступна для сканирования, не почти белая) выполняются:
      // размер задаёт владелец, а доступность — Allow в robots.ts.
      ...(logoUrl ? { logo: { "@type": "ImageObject", "@id": LOGO_ID, url: logoUrl, contentUrl: logoUrl } } : {}),
      ...(photoUrls.length > 0 ? { image: photoUrls } : {}),
      ...(sameAs.length > 0 ? { sameAs } : {}),
      ...(description ? { description } : {}),
    },
  ];

  // WebSite — узел, из которого Google берёт ИМЯ САЙТА для строки над
  // заголовком в выдаче (документация Google, "Site names"): без него там
  // остаётся голый домен my.rentos365.app, общий для всех тенантов, вместо
  // названия конкретного бизнеса.
  const website = [
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      url: canonicalUrl,
      name: data.tenant.name,
      inLanguage: data.tenant.locale,
      publisher: { "@id": ORG_ID },
    },
  ];

  // WebPage связывает страницу с сайтом и компанией и объявляет ГЛАВНУЮ
  // картинку — именно её поисковик берёт превью-миниатюрой к ссылке, если
  // решит её показать. Без primaryImageOfPage выбор произвольный.
  const webpage = [
    {
      "@type": "WebPage",
      "@id": PAGE_ID,
      url: canonicalUrl,
      name: data.metaTitleOverride ?? data.tagline,
      inLanguage: data.tenant.locale,
      isPartOf: { "@id": SITE_ID },
      about: { "@id": ORG_ID },
      // Сигнал свежести: страница живая, её правят. Берётся момент последней
      // правки лендинга — ровно то же значение, что стоит в lastmod карты сайта.
      dateModified: data.updatedAt.toISOString(),
      ...(description ? { description } : {}),
      ...(photos[0] ? { primaryImageOfPage: { "@id": photoId(photos[0].id) } } : {}),
    },
  ];

  const localBusinesses = data.points.map((point) => ({
    "@type": "LocalBusiness",
    "@id": `${canonicalUrl}#business-${point.id}`,
    name: `${data.tenant.name} — ${point.name}`,
    url: canonicalUrl,
    parentOrganization: { "@id": ORG_ID },
    // Фотографии, а не логотип: документация Google по LocalBusiness просит
    // в image именно снимки заведения, логотип живёт отдельным полем у
    // Organization. Логотип остаётся запасным вариантом, когда фото нет.
    ...(photoUrls.length > 0 ? { image: photoUrls } : logoUrl ? { image: logoUrl } : {}),
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

  const images = photos.map((p) => ({
    "@type": "ImageObject",
    "@id": photoId(p.id),
    contentUrl: `${baseUrl}${p.url}`,
    url: `${baseUrl}${p.url}`,
    name: p.name,
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [...website, ...webpage, ...organization, ...localBusinesses, ...images],
  };

  // JSON.stringify НЕ экранирует "</script>" — название тенанта/точки (owner-
  // редактируемые строки, попадают сюда как name/address/city) со строкой
  // "</script><script>..." закрыло бы этот тег раньше времени и включило бы
  // произвольный HTML на полностью публичной, неавторизованной странице
  // (реальная уязвимость, найдена аудитом 2026-07-27). "<" не меняет
  // смысл JSON (валидный escape для "<"), но не даёт браузеру распознать тег.
  const json = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
