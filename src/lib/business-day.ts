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

// Часы/минуты момента `at` в часовом поясе тенанта (Tenant.timezone,
// заполняется при регистрации по браузеру — см. /api/tenant/timezone) —
// без стороннего пакета, Intl.DateTimeFormat с timeZone умеет это сам.
// Невалидная/пустая таймзона (не должно случаться, но defensively) —
// откатываемся к UTC, прежнему поведению.
function localMinutesOfDay(at: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? at.getUTCHours());
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? at.getUTCMinutes());
    return hour * 60 + minute;
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

// Допуск начала смены (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА ВРЕМЕНИ") —
// попадает ли момент `at` в окно [centerTime−earlyMinutes; centerTime+lateMinutes]
// с учётом переноса через полночь (окно может начинаться накануне, если
// centerTime близко к 00:00). Если суммарная ширина окна покрывает целые
// сутки — ограничения фактически нет, разрешаем всегда.
//
// РЕАЛЬНЫЙ БАГ, найден 2026-07-12 (фидбек пользователя, скриншот: "смену
// можно начать с 09:00 до 16:00", часы показывают 09:15, check-in всё равно
// отклонён) — раньше здесь брались at.getUTCHours()/getUTCMinutes()
// напрямую, а defaultShiftStartTime вводится Владельцем в часовом поясе
// тенанта (Tenant.timezone), не в UTC. Для тенанта восточнее UTC (например,
// Молдова/Румыния, UTC+2/+3) реальные 09:15 по месту — это 06:15-07:15 UTC,
// что мимо окна "09:00±допуск" при сравнении в сырых UTC-минутах. Теперь
// сравнение идёт в локальных минутах тенанта (localMinutesOfDay выше).
//
// Тот же класс бага, вероятно, есть и в getBusinessDayBounds/isAtBoundaryMinute/
// isAtTimeMinute (используются в summary-scheduler.ts/daily-cash-trigger.ts
// для планирования "Кассы за день") — сознательно НЕ трогаем их в этом
// фиксе (кассовые триггеры — более широкий и рискованный кусок логики,
// заслуживает отдельного внимания, не патча в 3 часа ночи).
/** "HH:MM" границ окна допуска, только для отображения (сообщение об ошибке check-in). */
export function formatShiftStartWindow(
  centerTime: string,
  earlyMinutes: number,
  lateMinutes: number
): { start: string; end: string } {
  const { hours, minutes } = parseBoundary(centerTime);
  const centerMin = hours * 60 + minutes;
  const fmt = (m: number) => {
    const wrapped = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
  };
  return { start: fmt(centerMin - earlyMinutes), end: fmt(centerMin + lateMinutes) };
}

// Пересекает ли окно допуска начала смены границу бизнес-дня (только для
// предупреждения владельцу в настройках, ни на что не влияет функционально —
// businessDayBoundary продолжает бакетировать смены строго по фактическому
// startAt, окно допуска лишь решает "можно ли вообще начать сейчас"). Если
// пересекает — смена, начатая в этом "раннем хвосте", попадёт в предыдущий
// бизнес-день, хотя оператор может считать это началом сегодняшней смены.
export function toleranceCrossesBusinessDayBoundary(
  centerTime: string,
  boundaryTime: string,
  earlyMinutes: number,
  lateMinutes: number
): boolean {
  if (earlyMinutes + lateMinutes >= 24 * 60) return true;
  const { hours: ch, minutes: cm } = parseBoundary(centerTime);
  const { hours: bh, minutes: bm } = parseBoundary(boundaryTime);
  const centerMin = ch * 60 + cm;
  const boundaryMin = bh * 60 + bm;
  const lower = centerMin - earlyMinutes;
  const upper = centerMin + lateMinutes;
  return [boundaryMin, boundaryMin - 1440, boundaryMin + 1440].some((b) => b > lower && b < upper);
}

export function isWithinShiftStartWindow(
  centerTime: string,
  earlyMinutes: number,
  lateMinutes: number,
  at: Date,
  timezone: string
): boolean {
  if (earlyMinutes + lateMinutes >= 24 * 60) return true;
  const { hours, minutes } = parseBoundary(centerTime);
  const centerMin = hours * 60 + minutes;
  const nowMin = localMinutesOfDay(at, timezone);
  const lower = (((centerMin - earlyMinutes) % 1440) + 1440) % 1440;
  const upper = (((centerMin + lateMinutes) % 1440) + 1440) % 1440;
  return lower <= upper ? nowMin >= lower && nowMin <= upper : nowMin >= lower || nowMin <= upper;
}
