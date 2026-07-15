"use client";

import { createContext, useContext, useEffect, useState } from "react";

export const TEXT_SCALE_STEPS = ["xs", "s", "m", "l", "xl"] as const;
export type TextScale = (typeof TEXT_SCALE_STEPS)[number];

const ZOOM_BY_SCALE: Record<TextScale, number> = {
  xs: 0.875,
  s: 0.9375,
  m: 1,
  l: 1.0625,
  xl: 1.125,
};

export function textScaleZoom(scale: TextScale): number {
  return ZOOM_BY_SCALE[scale];
}

const STORAGE_KEY = "rentos-owner-text-scale";

// Личная настройка размера текста кабинета владельца (запрос пользователя
// 2026-07-15) — хранится в localStorage конкретного браузера/устройства,
// не в БД тенанта: это выбор конкретного владельца на своём устройстве, не
// параметр всей компании. Применяется через zoom только внутри OwnerShell
// (owner-shell.tsx) — оператор её экраны никогда не рендерит, поэтому даже
// при заходе с того же устройства/браузера PWA сотрудника не масштабируется.
const TextScaleContext = createContext<{ scale: TextScale; setScale: (scale: TextScale) => void } | null>(null);

export function TextScaleProvider({ children }: { children: React.ReactNode }) {
  const [scale, setScaleState] = useState<TextScale>("m");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (TEXT_SCALE_STEPS as readonly string[]).includes(stored)) {
      setScaleState(stored as TextScale);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function setScale(next: TextScale) {
    setScaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return <TextScaleContext.Provider value={{ scale, setScale }}>{children}</TextScaleContext.Provider>;
}

export function useTextScale() {
  const ctx = useContext(TextScaleContext);
  if (!ctx) throw new Error("useTextScale must be used within TextScaleProvider");
  return ctx;
}
