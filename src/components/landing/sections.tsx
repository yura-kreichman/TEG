import Image from "next/image";
import { MapPin, Phone, Share2, Play, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { LandingRenderData, LandingZonePointStatus } from "@/lib/landing/get-render-data";
import { contactHref } from "@/lib/landing/contact-links";
import { isIconFamily, type IconFamily } from "@/lib/icon-families";
import {
  TelegramIcon,
  ViberIcon,
  WhatsappIcon,
  InstagramIcon,
  FacebookIcon,
  TiktokIcon,
  VkIcon,
  OkIcon,
  YoutubeIcon,
} from "@/components/landing/social-icons";
import { MARKETING_SITE_URL } from "@/lib/billing";
import type { Dictionary } from "@/lib/i18n";
import { RichText } from "@/components/landing/rich-text";
import { isRichContentEmpty } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

type LP = Dictionary["landingPublic"];

// Секции публичной страницы Лендинга (docs/spec/08-landing.md, "Структура
// страницы" + "Правила вёрстки публичной страницы") — все серверные
// компоненты, включая ShareButton ниже: НЕ React "use client" (замер
// показал, что даже одна клиентская React-кнопка тянет ~230КБ react-dom-
// хайдрации на весь маршрут) — обычные <button>/<a> + ванильные <script>,
// подключаемые отдельно в page.tsx.

// Иконка зоны для плейсхолдера фото-хедера (докс, п.5) — НЕ импортирует
// src/components/icon-picker.tsx (тот целиком "use client", единственная
// причина — другие экспорты того же файла используют хуки; здесь нужна
// только чистая функция разбора iconKey + <img>/CSS-mask рендер, копия
// логики без клиентской границы, тот же путь /api/icon-library/{family}/{name}.svg).
function isValidIconKey(iconKey: string | null): boolean {
  if (!iconKey) return false;
  const sep = iconKey.indexOf(":");
  if (sep === -1) return false;
  const family = iconKey.slice(0, sep);
  const name = iconKey.slice(sep + 1);
  return isIconFamily(family) && !!name;
}

function ZoneIconGlyph({ iconKey, className }: { iconKey: string | null; className?: string }) {
  if (!iconKey) return null;
  const sep = iconKey.indexOf(":");
  if (sep === -1) return null;
  const family = iconKey.slice(0, sep);
  const name = iconKey.slice(sep + 1);
  if (!isIconFamily(family) || !name) return null;
  const src = `/api/icon-library/${family}/${name}.svg`;
  if ((family as IconFamily) === "material") {
    return (
      <span
        aria-hidden
        className={className}
        style={{
          display: "inline-block",
          backgroundColor: "currentColor",
          maskImage: `url(${src})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskImage: `url(${src})`,
          WebkitMaskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }
  // aspect-square — иконка всегда квадратная, а className варьируется по
  // вызову (разные size-* у разных секций), так что фиксированные
  // width/height-атрибуты не подходят; CSS aspect-ratio закрывает тот же
  // Lighthouse-аудит "у изображений не заданы явным образом width/height"
  // (найдено в отчёте PageSpeed Insights 2026-07-14) не хуже атрибутов.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden className={cn("aspect-square", className)} />;
}

export function Header({ data, lp }: { data: LandingRenderData; lp: LP }) {
  return (
    <header className="lt-wrap landing-reveal pt-7 pb-4">
      <div className="flex items-center gap-3.5">
        {data.tenant.logoUrl ? (
          <div className="lt-card lt-logo relative size-20 shrink-0 overflow-hidden sm:size-24">
            <Image
              src={data.tenant.logoUrl}
              alt={data.tenant.name}
              title={data.tenant.name}
              fill
              sizes="(max-width: 640px) 80px, 96px"
              className="object-cover"
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="lt-h1 text-2xl sm:text-[1.75rem]">{data.tenant.name}</h1>
          {data.tagline && <p className="lt-slogan mt-0.5 text-sm sm:text-base">{data.tagline}</p>}
        </div>
        <ShareButton title={data.tenant.name} lp={lp} />
      </div>
    </header>
  );
}

// Разделитель между крупными секциями страницы (докс: добавлено 2026-07-13
// — только whitespace между блоками не читался как разделение, нужна видимая
// линия, не на всю ширину экрана, а в той же 640px-колонке, что и контент).
export function SectionDivider() {
  return (
    <div className="lt-wrap">
      <hr className="lt-divider" />
    </div>
  );
}

// Заголовок секции на акцентной плашке (докс: добавлено 2026-07-13 — просто
// текст терялся, нужен визуальный вес). Плашка — span внутри h2 (не сам h2
// на всю ширину), h2 остаётся центрированным блоком, оборачивает разметку
// секций Развлечения/Где нас найти/Контакты одинаково.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="lt-h2-bar mb-4">
      <h2 className="lt-wrap lt-h2 lt-h2-bar-text text-center text-xl">{children}</h2>
    </div>
  );
}

// "О нас" — блок УТП сразу под видео, крупно и по центру (докс: обновлено
// 2026-07-13 — раньше был мелкий левый текст, терялся рядом с видео; п.1
// про левый край с этого момента на .about не распространяется).
export function AboutSection({ data }: { data: LandingRenderData }) {
  if (isRichContentEmpty(data.aboutText)) return null;
  return (
    <section className="lt-wrap landing-reveal py-5 text-center">
      <RichText doc={data.aboutText} className="lt-about-prose text-lg leading-snug font-medium sm:text-xl" />
    </section>
  );
}

// Галерея — горизонтальная лента без заголовка секции (докс, п.4 + эталон).
// Бесшовный бесконечный скролл (докс: уточнено пользователем 2026-07-13 —
// одного сброса scrollLeft в начало недостаточно, был заметный скачок) —
// лента рендерит фото ДВАЖДЫ подряд; вторая копия decorative (aria-hidden,
// без data-lightbox — иначе лайтбокс задвоил бы счётчик "N / M"), JS
// (landing-lightbox.js) переносит позицию ровно на ширину одного комплекта
// по достижении середины — переход визуально неотличим, т.к. там та же
// картинка.
export function GallerySection({ data }: { data: LandingRenderData }) {
  if (!data.galleryEnabled || data.galleryPhotos.length === 0) return null;
  const loop = data.galleryPhotos.length > 1;
  function renderItem(photo: { id: string; url: string }, i: number, duplicate: boolean) {
    return (
      <div key={`${photo.id}${duplicate ? "-dup" : ""}`} className="lt-gallery-item relative overflow-hidden" aria-hidden={duplicate || undefined}>
        <Image
          src={photo.url}
          alt={duplicate ? "" : `${data.tenant.name} — фото ${i + 1}`}
          title={duplicate ? undefined : `${data.tenant.name} — фото ${i + 1}`}
          fill
          sizes="200px"
          className="object-cover"
          {...(duplicate ? {} : { "data-lightbox-group": "gallery", "data-lightbox-src": photo.url })}
        />
      </div>
    );
  }
  return (
    <section className="lt-wrap landing-reveal pt-1 pb-5">
      <div className="lt-gallery-strip">
        {data.galleryPhotos.map((photo, i) => renderItem(photo, i, false))}
        {loop && data.galleryPhotos.map((photo, i) => renderItem(photo, i, true))}
      </div>
      {loop && (
        <div className="lt-gallery-dots" aria-hidden="true">
          {data.galleryPhotos.map((photo) => (
            <span key={photo.id} className="lt-gallery-dot" />
          ))}
        </div>
      )}
    </section>
  );
}

// Фасад видео (docs/spec/08-landing.md, "Секция видео") — между Галереей и
// "О нас" (докс, "Правила вёрстки", п.3). Рендерит ТОЛЬКО нашу сохранённую
// обложку (next/image) + Play поверх; iframe до клика не существует вообще
// (ни в HTML, ни в JS) — его создаёт public/landing-video.js по клику на
// data-video-play. Контейнер держит aspect-video НЕЗАВИСИМО от обложки
// (важно: JS прячет img по клику — без своего aspect-ratio высота
// схлопывалась бы в 0, реальный баг, найденный и исправленный 2026-07-13).
// Play-кнопка — тот же .lt-btn-primary, что и остальные primary-кнопки
// темы — акцент и форма темы, не хардкод (докс, п.12).
export function VideoSection({ data, lp }: { data: LandingRenderData; lp: LP }) {
  if (!data.videoEnabled || !data.videoYoutubeId || !data.videoPoster) return null;
  return (
    <section className="lt-wrap landing-reveal pt-1 pb-6">
      <div className="lt-card relative aspect-video w-full overflow-hidden">
        <Image
          src={data.videoPoster}
          alt={`${data.tenant.name} — видео`}
          title={`${data.tenant.name} — видео`}
          width={1280}
          height={720}
          sizes="(max-width: 640px) 100vw, 640px"
          className="block h-auto w-full object-cover"
          priority
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            data-video-play
            data-video-id={data.videoYoutubeId}
            aria-label={lp.playVideoLabel}
            className="lt-btn lt-btn-primary flex size-15 items-center justify-center"
          >
            <Play className="size-6 translate-x-0.5" fill="currentColor" />
          </button>
        </div>
      </div>
    </section>
  );
}

// "Цена: 35" / "Цены: 35 и 50" (докс, решение пользователя 2026-07-13:
// названия тарифов на публичной странице не показываем, только подпись
// "Цена"/"Цены" + значения — это НЕ то же самое, что чипы "{имя} — {цена}"
// из эталонного файла дизайн-фикса: тот пункт эталона явно отменён
// пользователем в тот же день, формат остаётся прежним). Лимит тарифов на
// зону — 2 (докс 02-money.md), но join написан общим случаем на N значений.
function formatPriceLine(tariffs: { price: number }[], lp: LP): string {
  const label = tariffs.length === 1 ? lp.priceSingleLabel : lp.pricesMultipleLabel;
  const values = tariffs.map((t) => String(t.price));
  const joined = values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} ${lp.pricesJoiner} ${values[values.length - 1]}`;
  return `${label}: ${joined}`;
}

// Группировка по точке (докс: у тенанта с несколькими точками "У нас
// работают" не должно читаться как одна общая локация). Порядок точек
// сохраняется как в исходном массиве (createdAt asc из запроса).
function groupByPoint<T extends { pointId: string; pointName: string; pointIconKey: string | null }>(
  items: T[]
): { pointId: string; pointName: string; pointIconKey: string | null; items: T[] }[] {
  const order: string[] = [];
  const groups = new Map<string, { pointId: string; pointName: string; pointIconKey: string | null; items: T[] }>();
  for (const item of items) {
    if (!groups.has(item.pointId)) {
      groups.set(item.pointId, { pointId: item.pointId, pointName: item.pointName, pointIconKey: item.pointIconKey, items: [] });
      order.push(item.pointId);
    }
    groups.get(item.pointId)!.items.push(item);
  }
  return order.map((id) => groups.get(id)!);
}

// Лента активов ВНУТРИ карточки зоны (докс, п.5а) — чистый CSS-слайдер, ноль
// JS/библиотек. Максимум 12 плюс тайл "+N ещё"; секция полностью
// отсутствует, если у зоны нет активов с фото (докс: "нет активов с фото —
// ленты нет"), а не пустая рамка. Бесшовный бесконечный скролл (докс:
// уточнено пользователем 2026-07-13, тот же приём, что у галереи выше) —
// весь комплект тайлов рендерится дважды, вторая копия decorative.
function ZoneFleetStrip({
  zone,
  tenantName,
  lp,
}: {
  zone: LandingRenderData["zones"][number];
  tenantName: string;
  lp: LP;
}) {
  if (zone.fleetAssets.length === 0) return null;
  const loop = zone.fleetAssets.length > 1 || zone.fleetOverflowCount > 0;
  function renderTiles(duplicate: boolean) {
    return (
      <>
        {zone.fleetAssets.map((asset) => (
          <li key={`${asset.id}${duplicate ? "-dup" : ""}`} className="lt-fleet-tile" aria-hidden={duplicate || undefined}>
            <div className="relative h-18 w-24 overflow-hidden rounded-[10px]">
              <Image
                src={asset.photoUrl}
                alt={duplicate ? "" : `${asset.name} — ${tenantName}`}
                title={duplicate ? undefined : `${asset.name} — ${tenantName}`}
                fill
                sizes="96px"
                loading="lazy"
                className="object-cover"
                {...(duplicate ? {} : { "data-lightbox-group": `zone-fleet-${zone.id}`, "data-lightbox-src": asset.photoUrl })}
              />
            </div>
          </li>
        ))}
        {zone.fleetOverflowCount > 0 && (
          <li className="lt-fleet-tile" aria-hidden={duplicate || undefined}>
            <div className="lt-fleet-more">+{zone.fleetOverflowCount}</div>
          </li>
        )}
      </>
    );
  }
  return (
    <ul
      className="lt-fleet-strip lt-hairline-top list-none px-4 pt-3 pb-4"
      aria-label={lp.fleetStripLabel.replace("{zoneName}", zone.name)}
    >
      {renderTiles(false)}
      {loop && renderTiles(true)}
    </ul>
  );
}

function zonePhotoAltText(zone: LandingRenderData["zones"][number], tenantName: string): string {
  return `${zone.name} — ${tenantName}${zone.pointCity ? `, ${zone.pointCity}` : ""}`;
}

export function RentalSection({ data, lp }: { data: LandingRenderData; lp: LP }) {
  const groups = groupByPoint(data.zones);
  // Подзаголовок с названием точки — только когда точек реально больше
  // одной; для единственной точки это был бы шум без смысла (докс, п.8).
  const showPointLabels = groups.length > 1;
  return (
    // id — якорь для прямых ссылок на раздел (#rental) и возможных
    // sitelinks/jump-to-section в поиске (решение пользователя 2026-07-14:
    // "сделай названия разделов якорями для лучшего SEO").
    <section id="rental" className="lt-wrap landing-reveal py-7">
      <SectionHeading>{lp.rentalTitle}</SectionHeading>
      <div className="flex flex-col gap-7">
        {groups.map((group, i) => (
          <div key={group.pointId}>
            {showPointLabels && i > 0 && <hr className="lt-point-divider" />}
            {showPointLabels && (
              <div className="lt-point-label mx-auto mb-4">
                <span className="lt-point-label-icon">
                  {isValidIconKey(group.pointIconKey) ? (
                    <ZoneIconGlyph iconKey={group.pointIconKey} className="size-6" />
                  ) : (
                    <MapPin className="size-6" />
                  )}
                </span>
                <span className="lt-point-label-name">{group.pointName}</span>
              </div>
            )}
            <div className="flex flex-col gap-5">
              {group.items.map((zone) => (
                <article key={zone.id} className="lt-card overflow-hidden">
                  <div className="lt-zone-photo-placeholder relative flex aspect-video items-center justify-center">
                    {zone.photoUrl ? (
                      <Image
                        src={zone.photoUrl}
                        alt={zonePhotoAltText(zone, data.tenant.name)}
                        title={zonePhotoAltText(zone, data.tenant.name)}
                        fill
                        sizes="(max-width: 640px) 100vw, 640px"
                        className="object-cover"
                        data-lightbox-group={`zone-header-${zone.id}`}
                        data-lightbox-src={zone.photoUrl}
                      />
                    ) : (
                      <ZoneIconGlyph iconKey={zone.iconKey} className="size-11" />
                    )}
                    {data.showPrices && zone.tariffs.length > 0 && (
                      <span className="lt-zone-price-overlay tabular-nums">{formatPriceLine(zone.tariffs, lp)}</span>
                    )}
                    <div className="lt-zone-name-overlay flex items-center gap-2.5 px-4 py-3.5">
                      {isValidIconKey(zone.iconKey) && (
                        <ZoneIconGlyph iconKey={zone.iconKey} className="size-5 shrink-0 text-white" />
                      )}
                      <h3 className="truncate text-2xl font-bold text-white">{zone.name}</h3>
                    </div>
                  </div>
                  {zone.caption && (
                    <div className="p-5 pb-4">
                      <RichText doc={zone.caption} className="font-medium" />
                    </div>
                  )}
                  <ZoneFleetStrip zone={zone} tenantName={data.tenant.name} lp={lp} />
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Статус этой ТОЧКИ (не тенант-уровня "Сегодня работают", докс п.9):
// "Открыто" (success-маркер) / "Откроется завтра в {время}" (нейтральный).
function PointOpenStatus({ status, lp, weekdayNames }: { status: LandingZonePointStatus; lp: LP; weekdayNames: string[] }) {
  if (status.kind === "open") {
    return <span className="lt-status-dot-open text-xs font-semibold">{lp.openNowBadge}</span>;
  }
  const time = status.time ?? "";
  const label =
    status.daysAhead === 0
      ? lp.opensTodayFrom.replace("{time}", time)
      : status.daysAhead === 1
        ? lp.opensTomorrowFrom.replace("{time}", time)
        : lp.nextOpenPrefix.replace("{time}", time).replace("{weekday}", weekdayNames[status.weekday ?? 0] ?? "");
  return <span className="lt-status-dot-neutral text-xs font-semibold">{label}</span>;
}

// Настоящие брендовые логотипы (src/components/landing/social-icons.tsx) —
// lucide-react в этой версии не содержит иконок соцсетей вообще.
const CONTACT_ICONS = {
  phone: Phone,
  telegram: TelegramIcon,
  viber: ViberIcon,
  whatsapp: WhatsappIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  tiktok: TiktokIcon,
  vk: VkIcon,
  ok: OkIcon,
  youtube: YoutubeIcon,
} as const;

// Капитализация "первая буква + остальное" не подходит для аббревиатур/camelCase брендов.
const CONTACT_LABELS: Partial<Record<keyof typeof CONTACT_ICONS, string>> = {
  vk: "VK",
  ok: "OK",
  youtube: "YouTube",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
};

// Контакты — объединено с "Где нас найти" (докс: уточнено пользователем
// 2026-07-13, отдельный заголовок был не нужен — точки, телефон и соцсети
// теперь один раздел "Контакты"). Точки: точка отображается всегда, если
// существует (докс, уточнение пользователя 2026-07-13: скрывать точку
// целиком из-за незаполненного адреса не нужно — просто не показываем то,
// чего нет). Кнопки: одна строка с переносом, "Позвонить" всегда первая и
// primary (докс, п.11), остальные ghost.
export function ContactsSection({ data, lp, weekdayNames }: { data: LandingRenderData; lp: LP; weekdayNames: string[] }) {
  const entries = (Object.entries(data.contacts) as [keyof typeof CONTACT_ICONS, string | null][])
    .map(([kind, value]) => ({ kind, value }))
    .filter((c): c is { kind: keyof typeof CONTACT_ICONS; value: string } => !!c.value)
    .sort((a, b) => (a.kind === "phone" ? -1 : b.kind === "phone" ? 1 : 0));
  if (data.points.length === 0 && entries.length === 0) return null;

  return (
    <section id="contacts" className="lt-wrap landing-reveal py-7">
      <SectionHeading>{lp.contactsTitle}</SectionHeading>
      {data.points.length > 0 && (
        <div className="mb-6 flex flex-col gap-5">
          {data.points.map((point) => {
            // Готовая ссылка владельца (Google/Яндекс.Карты) в приоритете —
            // координаты фолбэк, если ссылки нет (решение пользователя 2026-07-13).
            const mapsUrl =
              point.mapsUrl ??
              (point.latitude != null && point.longitude != null
                ? `https://maps.google.com/?q=${point.latitude},${point.longitude}`
                : null);
            return (
              <article key={point.id} className="lt-card lt-point-card p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="lt-card-title text-base">{point.name}</h3>
                  {point.openStatus && <PointOpenStatus status={point.openStatus} lp={lp} weekdayNames={weekdayNames} />}
                </div>
                {point.zoneNames.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {point.zoneNames.map((name) => (
                      <span key={name} className="lt-chip">
                        {name}
                      </span>
                    ))}
                  </div>
                )}
                {point.hoursNote && <p className="lt-muted-text mt-2 text-[0.8125rem]">{point.hoursNote}</p>}
                {(point.address || mapsUrl) && (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    {point.address ? (
                      <p className="lt-muted-text flex min-w-0 items-start gap-1.5 text-[0.8125rem]">
                        <MapPin className="mt-0.5 size-3.5 shrink-0" />
                        <span className="truncate">{point.address}</span>
                      </p>
                    ) : (
                      <span />
                    )}
                    {mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="lt-btn lt-btn-ghost inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
                      >
                        <MapPin className="size-3.5" />
                        {lp.openInMapsButton}
                      </a>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          {entries.map(({ kind, value }) => {
            const Icon = CONTACT_ICONS[kind];
            const isPhone = kind === "phone";
            const label = CONTACT_LABELS[kind] ?? kind[0]!.toUpperCase() + kind.slice(1);
            return (
              <a
                key={kind}
                href={contactHref(kind, value)}
                target={isPhone ? undefined : "_blank"}
                rel={isPhone ? undefined : "noreferrer"}
                aria-label={isPhone ? undefined : label}
                className={
                  isPhone
                    ? "lt-btn lt-btn-primary inline-flex min-w-35 flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-semibold"
                    : "lt-btn lt-btn-ghost flex size-11 shrink-0 items-center justify-center"
                }
              >
                <Icon className="size-4" />
                {isPhone && value}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function RulesSection({ data, lp }: { data: LandingRenderData; lp: LP }) {
  if (!data.rulesInstruction) return null;
  return (
    <section className="lt-wrap landing-reveal py-4 text-center">
      <a
        href={`/i/${data.slug}/${data.rulesInstruction.slug}`}
        className="lt-accent-text text-sm underline underline-offset-4"
      >
        {lp.rulesTitle}: {data.rulesInstruction.title}
      </a>
    </section>
  );
}

// Круглая кнопка "Поделиться" (докс, п.3) — только иконка, встроена в
// строку героя. НЕ React "use client" (см. комментарий в шапке файла) —
// обычная <button> + ванильный public/landing-share.js. url необязателен —
// без него скрипт берёт window.location.href (текущий адрес, включая
// превью-токен — правильнее, чем передавать заранее вычисленный
// канонический /s/{slug} и делиться неопубликованным превью не тем URL).
export function ShareButton({ title, url, lp }: { title: string; url?: string; lp: LP }) {
  return (
    <button
      type="button"
      data-share-button
      data-share-title={title}
      {...(url ? { "data-share-url": url } : {})}
      data-share-copied-label={lp.linkCopiedToast}
      aria-label={lp.shareButton}
      className="lt-btn lt-share-btn flex size-10 shrink-0 items-center justify-center"
    >
      <Share2 className="size-4" style={{ color: "var(--lt-ink)" }} />
    </button>
  );
}

export function LandingFooter({ data, lp }: { data: LandingRenderData; lp: LP }) {
  // Неон — единственная тёмная тема (докс, "Темы лендинга") — белый вариант
  // логотипа; остальные 5 тем светлые, тёмно-синий вариант читаем на всех.
  const logoVariant = data.theme === "neon" ? "dark" : "light";
  return (
    <footer className="lt-foot lt-wrap py-8 text-center text-xs">
      <a href={MARKETING_SITE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
        {lp.poweredByPrefix}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/icon-library/pwa/RentOS365-${logoVariant}.svg`} alt="RentOS365" className="h-3.5 w-auto" />
      </a>
    </footer>
  );
}

// Скелет лайтбокса (public/landing-lightbox.js) — рендерится один раз на
// странице, изначально скрыт (без .is-open). Разметка и иконки — настоящий
// React/Lucide, как у остальной страницы (докс: никаких emoji/текстовых
// глифов вместо иконок); JS-скрипт только переключает класс/src, ничего не
// строит через innerHTML — тот же принцип, что video/share-скрипты работают
// с уже отрендеренной серверной разметкой, а не создают её сами.
export function LightboxSkeleton({ lp }: { lp: LP }) {
  return (
    <div className="lt-lightbox">
      <button type="button" data-lightbox-close aria-label={lp.lightboxCloseLabel} className="lt-lightbox-close">
        <X className="size-5" />
      </button>
      <button type="button" data-lightbox-prev aria-label={lp.lightboxPrevLabel} className="lt-lightbox-nav lt-lightbox-prev">
        <ChevronLeft className="size-6" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- динамический src подставляет landing-lightbox.js, next/image здесь не подходит (произвольные исходники из разных коллекций, без предзнания размеров) */}
      <img data-lightbox-img alt="" className="lt-lightbox-img" />
      <button type="button" data-lightbox-next aria-label={lp.lightboxNextLabel} className="lt-lightbox-nav lt-lightbox-next">
        <ChevronRight className="size-6" />
      </button>
      <div data-lightbox-counter className="lt-lightbox-counter" />
    </div>
  );
}

// Эффект частиц (docs/spec/08-landing.md, "Эффекты лендинга") — при
// effect === "none" не рендерит вообще ничего: public/landing-effects.js не
// запрашивается браузером. window.load + dynamic import — движок стартует
// ПОСЛЕ полной загрузки страницы, не влияет на LCP.
export function LandingEffectLoader({ effect }: { effect: LandingRenderData["effect"] }) {
  if (effect === "none") return null;
  const script = `window.addEventListener('load',function(){import('/landing-effects.js').then(function(m){m.start(${JSON.stringify(effect)})})});`;
  return <script type="module" dangerouslySetInnerHTML={{ __html: script }} />;
}
