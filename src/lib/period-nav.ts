import { toDateStr } from "@/lib/datetime-format";
import { localDateParts } from "@/lib/business-day";
import type { Dictionary } from "@/lib/i18n";

// Week/month period navigation for the work-time tables — identical between
// the operator's own view (src/app/operator/work-time/page.tsx) and the
// owner's per-operator view (src/app/operators/[id]/page.tsx), previously
// copy-pasted between the two.
export type PeriodGranularity = "week" | "month";

// `anchor`/значения, возвращаемые отсюда — ВСЕГДА "календарное значение":
// год/месяц/день конкретного часового пояса тенанта, упакованные в Date как
// будто это UTC-полночь (Date.UTC(y, m, d)). Дальше по всему модулю с ними
// работают через getUTC*/Date.UTC — это НЕ настоящее UTC-время, а просто
// способ хранить календарную тройку в объекте Date; такая арифметика сама по
// себе корректна и не завязана на часовой пояс. Единственное место, где
// часовой пояс тенанта реально нужен — превращение "текущего момента" в эту
// календарную тройку, это и делает функция ниже (аудит 2026-07-27, второй
// раунд — раньше `new Date()` использовался НАПРЯМУЮ, то есть бралась
// календарная дата по UTC-времени сервера/браузера, а не по месту тенанта).
export function tenantTodayAnchor(timezone: string): Date {
  const { year, month, day } = localDateParts(new Date(), timezone);
  return new Date(Date.UTC(year, month - 1, day));
}

export function periodRange(granularity: PeriodGranularity, anchor: Date): { from: string; to: string } {
  const a = new Date(anchor);
  if (granularity === "week") {
    const dayIndex = (a.getUTCDay() + 6) % 7; // 0=Mon
    const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() - dayIndex));
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    return { from: toDateStr(start), to: toDateStr(end) };
  }
  const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0));
  return { from: toDateStr(start), to: toDateStr(end) };
}

export function isCurrentPeriod(granularity: PeriodGranularity, anchor: Date, timezone: string): boolean {
  const today = tenantTodayAnchor(timezone);
  if (granularity === "week") {
    const weekStart = (d: Date) => {
      const day = (d.getUTCDay() + 6) % 7;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
    };
    return weekStart(anchor) === weekStart(today);
  }
  return anchor.getUTCFullYear() === today.getUTCFullYear() && anchor.getUTCMonth() === today.getUTCMonth();
}

export function steppedAnchor(granularity: PeriodGranularity, anchor: Date, delta: number): Date {
  const next = new Date(anchor);
  if (granularity === "week") next.setUTCDate(next.getUTCDate() + delta * 7);
  else next.setUTCMonth(next.getUTCMonth() + delta);
  return next;
}

export function formatPeriodLabel(granularity: PeriodGranularity, anchor: Date, t: Dictionary): string {
  if (granularity === "week") {
    const dayIndex = (anchor.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - dayIndex));
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    return `${start.getUTCDate()}–${end.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]}`;
  }
  return `${t.readings.months[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
}
