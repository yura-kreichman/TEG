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
