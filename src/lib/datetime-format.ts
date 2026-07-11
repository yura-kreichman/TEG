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

export function formatDuration(minutes: number, t: Dictionary) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m
    ? `${h} ${t.operatorApp.workTime.hoursShort} ${m} ${t.operatorApp.workTime.minutesShort}`
    : `${h} ${t.operatorApp.workTime.hoursShort}`;
}
