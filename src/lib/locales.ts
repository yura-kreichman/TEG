// Client-safe locale metadata — deliberately split out of src/lib/i18n.ts
// (2026-07-12 fix): i18n.ts imports next/headers + Prisma for resolveLocale(),
// so any "use client" component importing from it (AuthLocalePicker,
// LocalePicker) pulled that whole server-only chain into the client bundle
// and crashed the dev server ("You're importing a module that depends on
// next/headers... in the Pages Router" — a red herring path in the error,
// the real cause was the client/server import boundary). This file has zero
// server-only imports, safe for both sides.
export type Locale = "ru" | "en" | "uk" | "uz" | "kk" | "ro" | "tg" | "ky" | "be" | "hy" | "az" | "ka" | "tr" | "pl";

// Порядок — как задал пользователь 2026-07-12 (ru/en/uk уже были, ro тоже;
// остальные 10 добавлены разом). Нативные названия — то, что видит сам
// носитель языка в переключателе, не английские названия языков.
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
  uk: "Українська",
  uz: "Oʻzbekcha",
  kk: "Қазақша",
  ro: "Română",
  tg: "Тоҷикӣ",
  ky: "Кыргызча",
  be: "Беларуская",
  hy: "Հայերեն",
  az: "Azərbaycanca",
  ka: "ქართული",
  tr: "Türkçe",
  pl: "Polski",
};

export const ALL_LOCALES = Object.keys(LOCALE_NAMES) as Locale[];

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(LOCALE_NAMES, value);
}
