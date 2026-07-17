// Client-safe locale metadata — deliberately split out of src/lib/i18n.ts
// (2026-07-12 fix): i18n.ts imports next/headers + Prisma for resolveLocale(),
// so any "use client" component importing from it (AuthLocalePicker,
// LocalePicker) pulled that whole server-only chain into the client bundle
// and crashed the dev server ("You're importing a module that depends on
// next/headers... in the Pages Router" — a red herring path in the error,
// the real cause was the client/server import boundary). This file has zero
// server-only imports, safe for both sides.
export type Locale = "ru" | "en" | "uk" | "ro" | "be" | "pl" | "it" | "uz" | "kk" | "tg" | "ky" | "hy" | "az" | "ka" | "tr";

// Порядок — сначала европейские языки (включая русский), потом остальные
// (запрос пользователя 2026-07-16: "Сначала Европейские, включая русский,
// потом все остальные"; до этого порядок был как их добавляли — ru/en/uk
// сразу, ro тоже, остальные 10 разом 2026-07-12). it добавлен тем же днём.
// Нативные названия — то, что видит сам носитель языка в переключателе, не
// английские названия языков.
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
  uk: "Українська",
  ro: "Română",
  be: "Беларуская",
  pl: "Polski",
  it: "Italiano",
  uz: "Oʻzbekcha",
  kk: "Қазақша",
  tg: "Тоҷикӣ",
  ky: "Кыргызча",
  hy: "Հայերեն",
  az: "Azərbaycanca",
  ka: "ქართული",
  tr: "Türkçe",
};

// Флаг страны, где язык основной/официальный — не претензия на "единственно
// верный" диалект, просто визуальный якорь в переключателе (2026-07-12).
// en → 🇬🇧, самый частый дефолт для "английский" в UI без региональной
// привязки к конкретной стране бизнеса.
export const LOCALE_FLAGS: Record<Locale, string> = {
  ru: "🇷🇺",
  en: "🇬🇧",
  uk: "🇺🇦",
  ro: "🇷🇴",
  be: "🇧🇾",
  pl: "🇵🇱",
  it: "🇮🇹",
  uz: "🇺🇿",
  kk: "🇰🇿",
  tg: "🇹🇯",
  ky: "🇰🇬",
  hy: "🇦🇲",
  az: "🇦🇿",
  ka: "🇬🇪",
  tr: "🇹🇷",
};

// Телефонный код страны — запрос пользователя 2026-07-17: "номер телефона
// абонемента должен учитывать региональные настройки Владельца", read-only
// префикс перед полем ввода в модуле "Абонементы". Источник — ТОЛЬКО
// Tenant.timezone (см. TIMEZONE_DIAL_INFO ниже), не Tenant.locale (язык
// интерфейса — личная настройка, оператор может переопределить свою) и не
// валюта (чисто визуальная, без привязки к стране): timezone — единственное
// поле, которое реально означает "где физически бизнес" (общее на весь
// тенант, без личного переопределения). Пример пользователя того же дня:
// "мне удобен русский язык, но я живу в Молдове — это выбрано в часовом
// поясе" — ru как locale ничего не говорит о стране, а часовой пояс говорит
// точно. LOCALE_DIAL_CODES ниже — резервный вариант по locale, когда
// TIMEZONE_DIAL_INFO почему-то не знает конкретную зону; kk (Казахстан)
// исторически делит +7 с Россией — отдельного кода нет.
export const LOCALE_DIAL_CODES: Record<Locale, string> = {
  ru: "+7",
  en: "+44",
  uk: "+380",
  ro: "+40",
  be: "+375",
  pl: "+48",
  it: "+39",
  uz: "+998",
  kk: "+7",
  tg: "+992",
  ky: "+996",
  hy: "+374",
  az: "+994",
  ka: "+995",
  tr: "+90",
};

// По IANA-зоне напрямую, не по locale — один locale может охватывать
// НЕСКОЛЬКО стран с разными кодами (Europe/Chisinau — Молдова, +373, живёт
// внутри "ro" рядом с Europe/Bucharest — Румыния, +40; без прямой карты по
// зоне обе получили бы один и тот же код через locale-посредник, что и было
// найдено запросом пользователя 2026-07-17). Значения флага здесь могут
// отличаться от LOCALE_FLAGS того же locale по той же причине (Молдова, не
// Румыния) — тут именно страна конкретной зоны, не страна языка.
export const TIMEZONE_DIAL_INFO: Record<string, { dialCode: string; flag: string }> = {
  "Europe/Chisinau": { dialCode: "+373", flag: "🇲🇩" },
  "Europe/Bucharest": { dialCode: "+40", flag: "🇷🇴" },
};

/**
 * Код страны + флаг для read-only префикса телефона по часовому поясу
 * тенанта (Tenant.timezone) — сначала точная зона (TIMEZONE_DIAL_INFO, ловит
 * случаи вроде Молдовы внутри "ro"), иначе locale, чей список зон
 * (LOCALE_TIMEZONES) содержит эту зону (LOCALE_DIAL_CODES/LOCALE_FLAGS),
 * иначе — дефолт "ru" (самый частый тенант в проекте на сегодня).
 */
export function dialInfoForTimezone(timezone: string): { dialCode: string; flag: string } {
  const exact = TIMEZONE_DIAL_INFO[timezone];
  if (exact) return exact;

  const locale = (Object.keys(LOCALE_TIMEZONES) as Locale[]).find((l) => LOCALE_TIMEZONES[l].includes(timezone));
  if (locale) return { dialCode: LOCALE_DIAL_CODES[locale], flag: LOCALE_FLAGS[locale] };

  return { dialCode: LOCALE_DIAL_CODES.ru, flag: LOCALE_FLAGS.ru };
}

export const ALL_LOCALES = Object.keys(LOCALE_NAMES) as Locale[];

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(LOCALE_NAMES, value);
}

// Кандидаты IANA-зон по стране языка (та же привязка язык->страна, что и
// LOCALE_FLAGS) — фидбек 2026-07-12: список часовых поясов Владельца должен
// быть ограничен странами языков RentOS, а не всеми ~400 зонами IANA.
// Несколько альтернативных написаний на страну (напр. Europe/Kyiv и
// Europe/Kiev для uk) — разные версии tzdata/ICU называют канонический алиас
// по-разному; getAllowedTimezones() ниже фильтрует по факту через
// Intl.supportedValuesOf на текущем рантайме, а не полагается на то, какое
// имя "победило" в конкретной сборке Node.
export const LOCALE_TIMEZONES: Record<Locale, string[]> = {
  ru: [
    "Europe/Moscow",
    "Europe/Kaliningrad",
    "Europe/Samara",
    "Europe/Volgograd",
    "Europe/Astrakhan",
    "Europe/Ulyanovsk",
    "Europe/Saratov",
    "Europe/Kirov",
    "Asia/Yekaterinburg",
    "Asia/Omsk",
    "Asia/Novosibirsk",
    "Asia/Barnaul",
    "Asia/Tomsk",
    "Asia/Novokuznetsk",
    "Asia/Krasnoyarsk",
    "Asia/Irkutsk",
    "Asia/Chita",
    "Asia/Yakutsk",
    "Asia/Khandyga",
    "Asia/Vladivostok",
    "Asia/Ust-Nera",
    "Asia/Magadan",
    "Asia/Sakhalin",
    "Asia/Srednekolymsk",
    "Asia/Kamchatka",
    "Asia/Anadyr",
  ],
  en: ["Europe/London"],
  uk: ["Europe/Kyiv", "Europe/Kiev", "Europe/Simferopol", "Europe/Uzhgorod", "Europe/Zaporozhye"],
  ro: ["Europe/Bucharest", "Europe/Chisinau"],
  be: ["Europe/Minsk"],
  pl: ["Europe/Warsaw"],
  it: ["Europe/Rome"],
  uz: ["Asia/Tashkent", "Asia/Samarkand"],
  kk: ["Asia/Almaty", "Asia/Aqtobe", "Asia/Aqtau", "Asia/Atyrau", "Asia/Oral", "Asia/Qyzylorda", "Asia/Qostanay"],
  tg: ["Asia/Dushanbe"],
  ky: ["Asia/Bishkek"],
  hy: ["Asia/Yerevan"],
  az: ["Asia/Baku"],
  ka: ["Asia/Tbilisi"],
  tr: ["Europe/Istanbul", "Asia/Istanbul"],
};

/** Плоский дедуплицированный список зон-кандидатов, отфильтрованный по тому, что реально знает текущий рантайм. */
export function getAllowedTimezones(): string[] {
  const supported = new Set(Intl.supportedValuesOf("timeZone"));
  const candidates = new Set(Object.values(LOCALE_TIMEZONES).flat());
  return [...candidates].filter((tz) => supported.has(tz)).sort();
}
