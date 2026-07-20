"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Тонкая полоска прогресса вверху экрана при переходе между страницами
 * (запрос пользователя 2026-07-20: "при переходе между Деньги и Отчёты...
 * появляется на секунду экран только фона... нет индикации, что это
 * загрузка"). Покрывает только сам факт перехода маршрута (клик по ссылке →
 * pathname реально сменился) — НЕ ожидание fetch() внутри уже смонтированной
 * страницы, это отдельная, обычно более долгая часть задержки в этом
 * приложении (клиентские fetch в useEffect, не серверный рендер) — под неё
 * отдельные скелетоны на самых тяжёлых экранах (Деньги/Отчёты), не эта
 * полоска. Глобальный компонент, монтируется один раз в (app)/layout.tsx —
 * общий для кабинета Владельца и PWA Оператора (оба под одним layout'ом).
 *
 * Без next/navigation useSearchParams() намеренно — тот хук требует
 * Suspense-границы в App Router, а pathname один уже покрывает подавляющее
 * большинство переходов в этом приложении (между разными экранами, а не
 * между query-параметрами одного и того же экрана).
 */
export function NavProgressBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const prevPathnameRef = useRef(pathname);
  const growTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Завершение — pathname реально сменился, значит новый маршрут
  // отрисовался; полоска долетает до 100% и гаснет.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (pathname === prevPathnameRef.current) return;
    prevPathnameRef.current = pathname;
    if (growTimeoutRef.current) clearTimeout(growTimeoutRef.current);
    setProgress(100);
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 200);
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Старт — перехват клика по любой внутренней ссылке в capture-фазе
  // документа (единая точка на всё приложение, не нужно трогать каждую
  // страницу/каждый <Link>). Пропускает переходы в новую вкладку, скачивание,
  // якоря на той же странице, внешние ссылки — только реальная internal-
  // навигация на другой маршрут.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === prevPathnameRef.current) return;
      setVisible(true);
      setProgress(15);
      if (growTimeoutRef.current) clearTimeout(growTimeoutRef.current);
      growTimeoutRef.current = setTimeout(() => setProgress(70), 300);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-100" aria-hidden="true">
      <div
        className="h-[3px] bg-primary shadow-[0_0_8px_var(--primary)] transition-[width] duration-300 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
