"use client";

import { useEffect, useState } from "react";

// Аудит 2026-07-27 (второй раунд) — период-навигация (period-nav.ts) и
// прямые вычисления "сегодня" в Отчётах/Деньгах/Товарах/Абонементах/Смене
// строились на getUTC*()/`new Date()` в браузере, то есть на UTC (или на
// часовом поясе самого браузера — тоже не то), а не на Tenant.timezone.
// Реальный эффект: у тенанта с ненулевым UTC-смещением (Europe/Kyiv и т.д.)
// в первые/последние часы календарного дня по местному времени владелец
// видел "сегодня"/границы периода со сдвигом на этот оффсет — например,
// кнопка "вперёд" на Отчётах оставалась заблокированной ещё несколько часов
// после начала настоящего сегодняшнего дня по месту. Единая точка получения
// часового пояса тенанта на клиенте — избегает N разных копий одного и того
// же fetch("/api/tenant/timezone") по всем экранам, которые его используют.
// endpoint — /api/tenant/timezone (Owner, requireOwner) по умолчанию;
// операторские экраны передают "/api/operator/tenant-timezone" (тот же
// приём, что уже используют PhoneInput/timezoneEndpoint) — своя сессия,
// тот же ответ {timezone}.
// Пока настоящий часовой пояс тенанта не пришёл с сервера — берём часовой
// пояс самого браузера посетителя (Intl), а не хардкод "UTC": он не всегда
// совпадает с часовым поясом тенанта (Настройки могут отличаться от места,
// откуда сейчас заходят), но для короткого окна до ответа fetch (обычно
// <100мс) это значительно более точное приближение, чем всегда-UTC — и
// именно этот сценарий (не UTC, а именно ЛЮБОЙ отличный от тенантского
// часовой пояс) и был первопричиной исходного бага.
function bestEffortInitialTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useTenantTimezone(endpoint: string = "/api/tenant/timezone"): string {
  const [timezone, setTimezone] = useState(bestEffortInitialTimezone);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.timezone) setTimezone(data.timezone);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return timezone;
}
