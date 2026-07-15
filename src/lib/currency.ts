// Курируемый справочник валют (docs/spec/03-design-system.md, "Числа и
// деньги" → "Валюта") — чисто визуальный элемент интерфейса, без курсов и
// конвертаций. Свободный ввод запрещён спекой, поэтому это фиксированная
// константа в коде, не таблица в БД. sign — то, что реально показывается
// суперскриптом рядом с суммой; label — человекочитаемое название для
// aria-label/подсказок, сам справочник не переводится по локали интерфейса
// (тот же принцип, что LOCALE_NAMES в lib/locales.ts — фиксированные
// названия, а не запись в словаре).
export const CURRENCIES = [
  { code: "RUB", sign: "₽", label: "Российский рубль" },
  { code: "MDL", sign: "L", label: "Молдавский лей" },
  { code: "RON", sign: "lei", label: "Румынский лей" },
  { code: "UAH", sign: "₴", label: "Украинская гривна" },
  { code: "UZS", sign: "soʻm", label: "Узбекский сум" },
  { code: "KZT", sign: "₸", label: "Казахстанский тенге" },
  { code: "TJS", sign: "смн", label: "Таджикский сомони" },
  { code: "KGS", sign: "с", label: "Киргизский сом" },
  { code: "BYN", sign: "Br", label: "Белорусский рубль" },
  { code: "AMD", sign: "֏", label: "Армянский драм" },
  { code: "AZN", sign: "₼", label: "Азербайджанский манат" },
  { code: "GEL", sign: "₾", label: "Грузинский лари" },
  { code: "TRY", sign: "₺", label: "Турецкая лира" },
  { code: "PLN", sign: "zł", label: "Польский злотый" },
  { code: "EUR", sign: "€", label: "Евро" },
  { code: "USD", sign: "$", label: "Доллар США" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCIES.some((c) => c.code === value);
}

export function getCurrencySign(code: string | null | undefined): string | null {
  if (!code) return null;
  return CURRENCIES.find((c) => c.code === code)?.sign ?? null;
}
