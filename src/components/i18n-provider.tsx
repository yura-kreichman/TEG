"use client";

import { createContext, useContext } from "react";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/locales";
import type { CurrencyCode } from "@/lib/currency";
import ru from "@lang/ru.json";

interface I18nContextValue {
  dict: Dictionary;
  locale: Locale;
  currency: CurrencyCode | null;
}

const I18nContext = createContext<I18nContextValue>({ dict: ru, locale: "ru", currency: null });

export function I18nProvider({
  dict,
  locale,
  currency = null,
  children,
}: {
  dict: Dictionary;
  locale: Locale;
  currency?: CurrencyCode | null;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={{ dict, locale, currency }}>{children}</I18nContext.Provider>;
}

/** Client-side access to the resolved dictionary — see src/lib/i18n.ts for how it's chosen. */
export function useI18n(): Dictionary {
  return useContext(I18nContext).dict;
}

// Код локали (для formatMoney и других мест, которым нужен не готовый
// перевод, а именно код языка, docs/spec/03-design-system.md, "Числа и
// деньги") — useI18n() намеренно отдаёт только словарь, не код, поэтому
// это отдельный хук, а не поле на Dictionary.
export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

// Код валюты тенанта (docs/spec/03-design-system.md, "Числа и деньги" →
// "Валюта") — null означает "не указана", единственный источник для <Money>.
export function useCurrency(): CurrencyCode | null {
  return useContext(I18nContext).currency;
}
