import type { Dictionary } from "@/lib/i18n";

// День/Неделя/Месяц/Год + произвольный период — выбор, одинаковый в Товарах
// ("Продажи"/"Кассы", запрос пользователя 2026-07-19) и в реестре продаж
// абонементов (Клиенты → "Продажи", запрос владельца 2026-08-16). Жил
// локальными функциями в goods/page.tsx; вынесен сюда, когда понадобился
// второму экрану — копия разъехалась бы с оригиналом при первой же правке.
//
// В отличие от lib/period-nav.ts (там только week/month для Рабочего
// времени) здесь четыре гранулярности.
export type SalesPeriodGranularity = "day" | "week" | "month" | "year";

export function salesPeriodDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isSalesPeriodCurrent(granularity: SalesPeriodGranularity, anchor: Date): boolean {
  const today = new Date();
  if (granularity === "year") return anchor.getUTCFullYear() === today.getUTCFullYear();
  if (granularity === "month") {
    return anchor.getUTCFullYear() === today.getUTCFullYear() && anchor.getUTCMonth() === today.getUTCMonth();
  }
  if (granularity === "day") return salesPeriodDateStr(anchor) === salesPeriodDateStr(today);
  const weekStart = (d: Date) => {
    const day = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  };
  return weekStart(anchor) === weekStart(today);
}

export function stepSalesPeriodAnchor(granularity: SalesPeriodGranularity, anchor: Date, delta: number): Date {
  const next = new Date(anchor);
  if (granularity === "day") next.setUTCDate(next.getUTCDate() + delta);
  else if (granularity === "week") next.setUTCDate(next.getUTCDate() + delta * 7);
  else if (granularity === "month") next.setUTCMonth(next.getUTCMonth() + delta);
  else next.setUTCFullYear(next.getUTCFullYear() + delta);
  return next;
}

export function formatSalesPeriodLabel(
  granularity: SalesPeriodGranularity,
  anchor: Date,
  t: Dictionary
): string {
  if (granularity === "year") return String(anchor.getUTCFullYear());
  if (granularity === "month") return `${t.readings.months[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
  if (granularity === "day") {
    return `${anchor.getUTCDate()} ${t.readings.monthsGenitive[anchor.getUTCMonth()]} (${t.readings.weekdaysFull[(anchor.getUTCDay() + 6) % 7]})`;
  }
  const day = (anchor.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - day));
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return sameMonth
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]}`
    : `${start.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]} – ${end.getUTCDate()} ${t.readings.monthsGenitive[end.getUTCMonth()]}`;
}

// Границы выбранного периода в виде YYYY-MM-DD — то, что уходит в API.
export function salesPeriodRange(
  granularity: SalesPeriodGranularity,
  anchor: Date
): { from: string; to: string } {
  if (granularity === "day") {
    const d = salesPeriodDateStr(anchor);
    return { from: d, to: d };
  }
  if (granularity === "year") {
    return { from: `${anchor.getUTCFullYear()}-01-01`, to: `${anchor.getUTCFullYear()}-12-31` };
  }
  if (granularity === "month") {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return { from: salesPeriodDateStr(start), to: salesPeriodDateStr(end) };
  }
  const day = (anchor.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - day));
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { from: salesPeriodDateStr(start), to: salesPeriodDateStr(end) };
}
