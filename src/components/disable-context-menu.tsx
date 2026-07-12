"use client";

import { useEffect } from "react";

// Долгий тап на ссылку в PWA открывал нативное контекстное меню Chrome
// ("Копировать адрес ссылки", "Открывать в браузере Chrome" и т.п.) —
// фидбек 2026-07-12. user-select:none (globals.css) убирает выделение
// текста, но никак не влияет на это меню — это отдельное поведение браузера
// специально для <a href>, привязанное к событию contextmenu, а не к
// выделению. Единственный способ его убрать — перехватить само событие;
// preventDefault() не мешает обычному тапу/навигации по ссылке, глушит
// только долгий тап (и правый клик мышью на десктопе, тот же ивент).
export function DisableContextMenu() {
  useEffect(() => {
    const handler = (event: Event) => event.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return null;
}
