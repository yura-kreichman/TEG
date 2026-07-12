"use client";

import { useEffect } from "react";

// Долгий тап на ссылку в PWA открывал нативное контекстное меню Chrome
// ("Копировать адрес ссылки", "Открывать в браузере Chrome" и т.п.) —
// фидбек 2026-07-12. user-select:none (globals.css) убирает выделение
// текста, но никак не влияет на это меню — это отдельное поведение браузера
// специально для <a href>, привязанное к событию contextmenu, а не к
// выделению. preventDefault() не мешает обычному тапу/навигации по ссылке,
// глушит только долгий тап/правый клик именно на ссылке.
//
// Раньше глушился ЛЮБОЙ contextmenu на странице — это заодно ломало
// правый-клик "Вставить" везде, включая редактор Инструктажей (нашёл
// пользователь 2026-07-12: "копирую текст с сайта, вставить в редактор не
// получается" — оказалось, дело не в редакторе, контекстное меню браузера
// просто не открывалось нигде в приложении). Сузил до самой ссылки — тот
// единственный случай, который реально просили скрыть.
export function DisableContextMenu() {
  useEffect(() => {
    const handler = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a")) event.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return null;
}
