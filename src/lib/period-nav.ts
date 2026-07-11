import { toDateStr } from "@/lib/datetime-format";
import type { Dictionary } from "@/lib/i18n";

// Week/month period navigation for the work-time tables — identical between
// the operator's own view (src/app/operator/work-time/page.tsx) and the
// owner's per-operator view (src/app/operators/[id]/page.tsx), previously
// copy-pasted between the two.
export type PeriodGranularity = "week" | "month";

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

export function isCurrentPeriod(granularity: PeriodGranularity, anchor: Date): boolean {
  const today = new Date();
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
