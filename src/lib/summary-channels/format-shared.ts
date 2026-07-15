// Pure formatting helpers shared by telegram-format.ts and email-format.ts —
// previously copy-pasted identically (or near-identically) between the two.

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Telegram uses "dd/mm (weekday)", email uses "dd.mm (weekday)". */
export function formatSummaryDate(d: Date, separator: "/" | "."): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const weekday = WEEKDAYS[(d.getUTCDay() + 6) % 7];
  return `${day}${separator}${month} (${weekday})`;
}

export function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// Суммы в сводках — только целые числа (запрос пользователя 2026-07-14: копейки
// не нужны, только целые), округление обычное (не отбрасывание дробной части).
export function formatAmount(n: number): string {
  return String(Math.round(n));
}
