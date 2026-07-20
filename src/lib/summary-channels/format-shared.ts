// Pure formatting helpers shared by telegram-format.ts and email-format.ts —
// previously copy-pasted identically (or near-identically) between the two.

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// compact=true — "м" вместо "мин" (запрос пользователя 2026-07-20: "как
// сейчас '12 ч 34 мин' сократи до '12 ч 34 м'"), только для компактных
// сводок — полная сводка Закрытия смены по-прежнему пишет "мин" целиком.
export function formatDuration(minutes: number, compact = false): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const unit = compact ? "м" : "мин";
  return m ? `${h} ч ${m} ${unit}` : `${h} ч`;
}

// Часовой пояс тенанта, не сырой UTC сервера (реальный баг, найден
// 2026-07-15 по скриншоту сводки Закрытия смены: "10:00-22:25" в реальности
// показывалось как "07:00-19:25" — тот же класс бага, что раньше починили
// для getBusinessDayBounds/isWithinShiftStartWindow в business-day.ts, но
// именно ДО этих двух функций формата сводок он не добрался). Резолвится
// через Intl.DateTimeFormat, без стороннего пакета — та же техника, что
// localMinutesOfDay в business-day.ts.
function localParts(d: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const weekdayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday") ?? "Mon");
    return {
      day: get("day") ?? String(d.getUTCDate()).padStart(2, "0"),
      month: get("month") ?? String(d.getUTCMonth() + 1).padStart(2, "0"),
      hour: get("hour") ?? String(d.getUTCHours()).padStart(2, "0"),
      minute: get("minute") ?? String(d.getUTCMinutes()).padStart(2, "0"),
      weekday: WEEKDAYS[weekdayIndex === -1 ? (d.getUTCDay() + 6) % 7 : weekdayIndex],
    };
  } catch {
    return {
      day: String(d.getUTCDate()).padStart(2, "0"),
      month: String(d.getUTCMonth() + 1).padStart(2, "0"),
      hour: String(d.getUTCHours()).padStart(2, "0"),
      minute: String(d.getUTCMinutes()).padStart(2, "0"),
      weekday: WEEKDAYS[(d.getUTCDay() + 6) % 7],
    };
  }
}

/** Telegram uses "dd/mm (weekday)", email uses "dd.mm (weekday)". */
export function formatSummaryDate(
  d: Date,
  separator: "/" | ".",
  timezone: string,
  includeWeekday = true
): string {
  const { day, month, weekday } = localParts(d, timezone);
  return includeWeekday ? `${day}${separator}${month} (${weekday})` : `${day}${separator}${month}`;
}

export function formatLocalTime(d: Date, timezone: string): string {
  const { hour, minute } = localParts(d, timezone);
  return `${hour}:${minute}`;
}
