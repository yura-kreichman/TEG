import type { Locale } from "@/lib/locales";

// BCP-47 теги для Intl.NumberFormat — параллельно LOCALE_TIMEZONES/LOCALE_FLAGS
// в lib/locales.ts (та же привязка "язык интерфейса -> основная страна"),
// но не туда же: это единственное место в проекте, которому нужен именно
// формат чисел, а не часовой пояс/флаг.
const LOCALE_TO_INTL: Record<Locale, string> = {
  ru: "ru-RU",
  en: "en-GB",
  uk: "uk-UA",
  uz: "uz-UZ",
  kk: "kk-KZ",
  ro: "ro-RO",
  tg: "tg-TJ",
  ky: "ky-KG",
  be: "be-BY",
  hy: "hy-AM",
  az: "az-AZ",
  ka: "ka-GE",
  tr: "tr-TR",
  pl: "pl-PL",
};

// Единый форматтер денежных сумм (docs/spec/03-design-system.md, "Числа и
// деньги") — целое значение без дробной части ("35"), дробное — ровно 2
// знака ("257,64"). Прямые .toFixed()/.toLocaleString() в компонентах
// запрещены спекой, это единственная точка форматирования денег в проекте.
// Разделители — Intl.NumberFormat по локали (для ru реальный разделитель
// тысяч — NBSP U+00A0, не обычный пробел; это корректная типографика
// Intl/ГОСТ, а не опечатка).
export function formatMoney(value: number, locale: Locale = "ru"): string {
  const rounded = Math.round(value * 100) / 100;
  const hasFraction = rounded % 1 !== 0;
  return new Intl.NumberFormat(LOCALE_TO_INTL[locale], {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}

// Сокращённая форма для тесных ячеек (напр. тепловая карта отчётов, docs/spec
// не регламентирует — локальное решение для компактных виджетов, не общий
// денежный формат): тысячи/миллионы с одной цифрой после запятой, суффиксы —
// строки i18n от вызывающей стороны (спека запрещает захардкоженные строки UI
// вне /lang/*.json, поэтому не хардкодим "к"/"М" здесь).
export function formatMoneyCompact(
  value: number,
  locale: Locale,
  thousandSuffix: string,
  millionSuffix: string
): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const unit = abs >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = abs >= 1_000_000 ? millionSuffix : thousandSuffix;
  const scaled = Math.round((abs / unit) * 10) / 10;
  const hasFraction = scaled % 1 !== 0;
  const formatted = new Intl.NumberFormat(LOCALE_TO_INTL[locale], {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(scaled);
  return sign + formatted + suffix;
}
