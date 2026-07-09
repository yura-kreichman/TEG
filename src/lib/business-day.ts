// Бизнес-день с произвольной границей (по умолчанию 06:00) — сдачи/смены до
// этого часа относятся к предыдущему дню (docs/spec/telegram-summaries.md,
// "Касса за день"). Считаем в UTC, как и весь день-математика в проекте
// (см. business-day boundary в /api/reports/money, /api/reports/counters/day) —
// тот же самый известный пробел: нет хранимого часового пояса тенанта, эта
// граница по времени сервера, не по времени точки.

function parseBoundary(boundaryTime: string): { hours: number; minutes: number } {
  const [hours, minutes] = boundaryTime.split(":").map(Number);
  return { hours, minutes };
}

/** Бизнес-день, которому принадлежит момент `at` при данной границе. */
export function getBusinessDayBounds(boundaryTime: string, at: Date): { start: Date; end: Date } {
  const { hours, minutes } = parseBoundary(boundaryTime);
  const boundaryToday = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), hours, minutes)
  );

  const start = at >= boundaryToday ? boundaryToday : new Date(boundaryToday.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Дата (полночь UTC) для группировки/уникальности — "какой это бизнес-день". */
export function businessDateKey(bounds: { start: Date }): Date {
  return new Date(
    Date.UTC(bounds.start.getUTCFullYear(), bounds.start.getUTCMonth(), bounds.start.getUTCDate())
  );
}

/** Только что миновала ли граница дня в минуту `at` (для планировщика, тик раз в минуту). */
export function isAtBoundaryMinute(boundaryTime: string, at: Date): boolean {
  const { hours, minutes } = parseBoundary(boundaryTime);
  return at.getUTCHours() === hours && at.getUTCMinutes() === minutes;
}

export function isAtTimeMinute(timeStr: string, at: Date): boolean {
  const { hours, minutes } = parseBoundary(timeStr);
  return at.getUTCHours() === hours && at.getUTCMinutes() === minutes;
}
