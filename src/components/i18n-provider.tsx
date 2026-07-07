"use client";

import { createContext, useContext } from "react";
import type { Dictionary } from "@/lib/i18n";
import ru from "@lang/ru.json";

const I18nContext = createContext<Dictionary>(ru);

export function I18nProvider({
  dict,
  children,
}: {
  dict: Dictionary;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={dict}>{children}</I18nContext.Provider>;
}

/** Client-side access to the resolved dictionary — see src/lib/i18n.ts for how it's chosen. */
export function useI18n(): Dictionary {
  return useContext(I18nContext);
}
