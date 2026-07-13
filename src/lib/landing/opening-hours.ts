import { localMinutesOfDay } from "@/lib/business-day";

// weekday: 0=понедельник..6=воскресенье (docs/spec/08-landing.md,
// PointOpeningHours) — НЕ JS Date.getDay(), конвертация явная ниже.
export interface DayHours {
  weekday: number;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export interface NextOpen {
  weekday: number;
  time: string;
  isTomorrow: boolean;
  // 0 = позже сегодня, 1 = завтра, 2..6 = дальше на неделе — для сравнения
  // "какое открытие ближе" между несколькими точками (see today-status.ts).
  daysAhead: number;
}

/** Все 7 строк должны существовать — иначе "часы не заполнены" (докс). */
export function hasConfiguredHours(hours: DayHours[]): boolean {
  return hours.length === 7;
}

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function localWeekday(at: Date, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(at);
  return WEEKDAY_SHORT_TO_INDEX[short] ?? 0;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** null = недостаточно данных (часы не заполнены), не рендерить статус (докс). */
export function isOpenNow(hours: DayHours[], timezone: string, at: Date = new Date()): boolean | null {
  if (!hasConfiguredHours(hours)) return null;
  const weekday = localWeekday(at, timezone);
  const today = hours.find((h) => h.weekday === weekday);
  if (!today || !today.isOpen || !today.opensAt || !today.closesAt) return false;

  const nowMin = localMinutesOfDay(at, timezone);
  return nowMin >= toMinutes(today.opensAt) && nowMin < toMinutes(today.closesAt);
}

/**
 * Ближайшее открытие — сегодня позже (если ещё не открывались) или в
 * ближайший рабочий день (докс: "Завтра с {время}" или ближайший рабочий
 * день). null = либо данных нет, либо все 7 дней закрыты (не должно
 * встречаться в реальных данных, но не считается ошибкой).
 */
export function findNextOpen(hours: DayHours[], timezone: string, at: Date = new Date()): NextOpen | null {
  if (!hasConfiguredHours(hours)) return null;
  const weekday = localWeekday(at, timezone);
  const nowMin = localMinutesOfDay(at, timezone);

  const today = hours.find((h) => h.weekday === weekday);
  if (today?.isOpen && today.opensAt && nowMin < toMinutes(today.opensAt)) {
    return { weekday, time: today.opensAt, isTomorrow: false, daysAhead: 0 };
  }

  for (let offset = 1; offset <= 7; offset++) {
    const candidateWeekday = (weekday + offset) % 7;
    const day = hours.find((h) => h.weekday === candidateWeekday);
    if (day?.isOpen && day.opensAt) {
      return { weekday: candidateWeekday, time: day.opensAt, isTomorrow: offset === 1, daysAhead: offset };
    }
  }
  return null;
}
