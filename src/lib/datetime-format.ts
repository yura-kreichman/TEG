import type { Dictionary } from "@/lib/i18n";

// Client-safe date/time formatting helpers, shared by owner/operator pages that
// display local device time (not UTC — see individual call sites for why).
// Previously copy-pasted identically across 6 page components.

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function toDateStr(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Local device time (not UTC) — shows/edits what's actually on the clock. */
export function formatTime(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Час:минута "сейчас" В ЧАСОВОМ ПОЯСЕ ТЕНАНТА, не устройства (реальный баг,
 * найден пользователем 2026-07-22: "Ушёл" в форме "Новая смена" по
 * умолчанию бралось через date.getHours()/getMinutes() — часы/минуты
 * УСТРОЙСТВА оператора, а не бизнес-часового пояса тенанта; на устройстве с
 * другим системным часовым поясом, чем у точки, подставлялось неверное
 * время). new Date() сам по себе всегда корректен (абсолютный момент) — баг
 * был именно в том, КАК из него доставали час/минуту для отображения.
 */
export function nowInTimezone(timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

export function formatDuration(minutes: number, t: Dictionary) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m
    ? `${h} ${t.operatorApp.workTime.hoursShort} ${m} ${t.operatorApp.workTime.minutesShort}`
    : `${h} ${t.operatorApp.workTime.hoursShort}`;
}
