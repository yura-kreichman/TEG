"use client";

import { useEffect } from "react";

/**
 * Не даёт экрану гаснуть, пока открыт экран, за которым реально смотрят
 * (запрос владельца 2026-08-13).
 *
 * Зачем. Планшет точки — это витрина с живыми данными: у «Прибываний» и
 * «Пусков» тикают таймеры пусков, в мастере сдачи итогов сотрудник
 * пересчитывает кассу и сверяет цифры на экране. Системное затемнение через
 * минуту-полторы гасит ровно то, ради чего экран и открыли, и сотруднику
 * приходится будить планшет каждый раз, когда он поднял глаза от денег.
 *
 * Поддержка. Screen Wake Lock есть и в Safari с 16.4 (WebKit-блог о
 * возможностях 16.4), и в Chromium — то есть работает и на iPad с домашнего
 * экрана, и на Android-планшете. Там, где API нет, хук молча ничего не
 * делает: никаких предупреждений, поведение остаётся прежним.
 *
 * ВАЖНО про повторный захват. Блокировка снимается системой автоматически,
 * как только вкладка перестаёт быть видимой (свернули приложение, погасили
 * экран кнопкой). Обратно она САМА не возвращается — поэтому подписываемся на
 * visibilitychange и берём её заново. Без этого хук работал бы ровно до
 * первого сворачивания, и это ошибка, которую легко не заметить: на глаз всё
 * выглядит рабочим.
 *
 * Запрос требует, чтобы документ был видим, иначе браузер отклоняет его с
 * ошибкой — поэтому проверяем visibilityState и глотаем отказ.
 */
export function useWakeLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Отказ — норма, а не сбой: батарея на исходе, политика устройства,
        // вкладка успела спрятаться. Экран просто будет гаснуть как обычно.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Отпускаем явно при уходе с экрана — иначе блокировка пережила бы
      // переход на страницу, где она не нужна (SPA-навигация не
      // перезагружает документ, система сама её не снимет).
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
