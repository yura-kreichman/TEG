"use client";

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 25000;

/**
 * Держит данные Сотрудника свежими без перезахода на экран (запрос
 * пользователя 2026-07-22: "когда владелец делает любое действие, которое
 * касается Сотрудника... у него должно обновляться" — деактивация доступа к
 * зоне, к товару, и т.п.). Устройство оператора — терминал на точке, может
 * часами оставаться открытым на одном экране (не как обычная SPA-навигация,
 * где переход на экран и обратно сам обновил бы данные), поэтому одного
 * fetch на монтирование недостаточно.
 *
 * Опрос каждые ~25с + немедленный повторный запрос при возврате
 * фокуса/видимости вкладки (экран разблокировали, вернулись из другого
 * приложения) — выбрано пользователем явно (не чистый polling без focus, не
 * только focus без polling: устройство-термнал может часами держать один и
 * тот же экран, ни разу не теряя фокус).
 *
 * НЕ использовать в мастере сдачи итогов (operator/submit/page.tsx) —
 * данные под ногами у уже начатой многошаговой формы менять рискованно
 * (потеря черновика/скачки UI), точечно исключено намеренно.
 */
export function useLiveRefetch(loadFn: () => void, intervalMs: number = DEFAULT_INTERVAL_MS) {
  const loadFnRef = useRef(loadFn);
  // Синхронизация ref — ТОЛЬКО в эффекте, не в теле рендера (react-hooks/refs
  // запрещает мутировать ref во время рендера, даже для стандартного паттерна
  // "всегда свежий колбэк без пересоздания интервала").
  useEffect(() => {
    loadFnRef.current = loadFn;
  });

  useEffect(() => {
    const interval = setInterval(() => loadFnRef.current(), intervalMs);

    function onVisible() {
      if (document.visibilityState === "visible") loadFnRef.current();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [intervalMs]);
}
