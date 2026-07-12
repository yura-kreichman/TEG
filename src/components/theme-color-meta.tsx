"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

// Держит <meta name="theme-color"> в синхроне с реальной темой приложения
// (фидбек 2026-07-12: "под нижним баром меню нет расплывчивости" — на
// самом деле дело не в самом .nav-glass blur, а в системной area под ним
// на мобильном: viewport.themeColor в layout.tsx статичный (#18181b,
// тёмный), а кабинет владельца по умолчанию светлый — системная строка
// жеста/статус-бар под стеклянным баром красилась в несочетающийся тёмный
// цвет без какого-либо блюра, раз это уже не веб-контент, а хром ОС).
// next-themes даёт только класс на <html>, сам meta-тег не трогает —
// обновляем вручную при каждой смене темы. Цвета — ровно --background
// каждой темы (globals.css), не новый цвет "от себя".
const THEME_COLORS = { light: "#ffffff", dark: "#141917" } as const;

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const color = resolvedTheme === "dark" ? THEME_COLORS.dark : THEME_COLORS.light;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [resolvedTheme]);

  return null;
}
