// Бизнес-день с произвольной границей (по умолчанию 06:00) — сдачи/смены до
// этого часа относятся к предыдущему дню (docs/spec/telegram-summaries.md,
// "Касса за день"). Граница вводится Владельцем в часовом поясе тенанта
// (Tenant.timezone), поэтому вся арифметика ниже — в этом часовом поясе, не
// в сыром UTC сервера (РЕАЛЬНЫЙ БАГ, найден 2026-07-12 при аудите перед
// запуском — тот же класс, что уже чинили для isWithinShiftStartWindow
// 2026-07-12 раньше; тогда сознательно не трогали getBusinessDayBounds/
// isAtBoundaryMinute/isAtTimeMinute как "более рискованный кусок логики" —
// аудит перед реальным запуском был поводом наконец это закрыть).

function parseBoundary(boundaryTime: string): { hours: number; minutes: number } {
  const [hours, minutes] = boundaryTime.split(":").map(Number);
  return { hours, minutes };
}

// Часы/минуты момента `at` в часовом поясе тенанта — без стороннего пакета,
// Intl.DateTimeFormat с timeZone умеет это сам. Невалидная/пустая таймзона
// (не должно случаться, но defensively) — откатываемся к UTC.
// Экспортируется отдельно от бизнес-дня — переиспользуется Лендингом
// (docs/spec/08-landing.md: "сейчас открыто/закрыто", дневные агрегаты
// статистики по календарному дню тенанта) тем же приёмом Intl, без
// дублирования арифметики часовых поясов.
export function localMinutesOfDay(at: Date, timezone: string): number {
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

// Y/M/D частей `at` в часовом поясе тенанта — календарная дата "по месту",
// не по UTC (может отличаться от at.getUTC* около полуночи).
export function localDateParts(at: Date, timezone: string): { year: number; month: number; day: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { year: get("year"), month: get("month"), day: get("day") };
  } catch {
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
  }
}

// Переводит "стенные часы" (год/месяц/день/час/минута) в часовом поясе
// тенанта в точный момент UTC — стандартный приём "round-trip через Intl"
// без сторонней библиотеки: сперва трактуем эти числа как UTC (guess), затем
// смотрим, что Intl показывает в целевой таймзоне ДЛЯ ЭТОГО guess-момента, и
// компенсируем разницу. Работает корректно и для дат около перехода на/с
// летнего времени, потому что смещение берётся на сам guess-момент, а не
// откуда-то ещё.
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timezone: string
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return new Date(guess.getTime() + (guess.getTime() - asIfUtc));
  } catch {
    return guess;
  }
}

/** Бизнес-день, которому принадлежит момент `at` при данной границе, в часовом поясе `timezone`. */
export function getBusinessDayBounds(boundaryTime: string, at: Date, timezone: string): { start: Date; end: Date } {
  const { hours, minutes } = parseBoundary(boundaryTime);
  const { year, month, day } = localDateParts(at, timezone);
  const boundaryToday = zonedWallTimeToUtc(year, month, day, hours, minutes, timezone);

  const start = at >= boundaryToday ? boundaryToday : new Date(boundaryToday.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Дата (полночь UTC) для группировки/уникальности — "какой это бизнес-день",
 * в календаре ЧАСОВОГО ПОЯСА тенанта, не сырого UTC момента bounds.start.
 *
 * РЕАЛЬНЫЙ БАГ, найден 2026-07-17 (жалоба пользователя: "Касса за день"
 * пришла для точки, где всё уже закрыто — расследование показало не дубль
 * отправки, а неверную дату в самой записи доставки). bounds.start — момент
 * границы бизнес-дня в часовом поясе тенанта, переведённый в UTC; для пояса
 * восточнее UTC (например, Кишинёв +3) с ранней границей (например, 02:00)
 * этот момент в UTC — это ещё 23:00 ПРЕДЫДУЩЕГО календарного дня. Старая
 * версия читала getUTCDate() этого момента напрямую и получала бизнес-день
 * на сутки раньше правильного (сдача 16 июля помечалась как "15 июля").
 * Сдвиг на 12 часов внутрь бизнес-дня перед чтением локальной даты —
 * гарантированно подальше от самой границы (в т.ч. от перехода на/с
 * летнего времени, если он выпадает точно на границу).
 */
export function businessDateKey(bounds: { start: Date }, timezone: string): Date {
  const { year, month, day } = localDateParts(new Date(bounds.start.getTime() + 12 * 60 * 60 * 1000), timezone);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Только что миновала ли граница дня в минуту `at` по часовому поясу тенанта (для планировщика, тик раз в минуту). */
export function isAtBoundaryMinute(boundaryTime: string, at: Date, timezone: string): boolean {
  const { hours, minutes } = parseBoundary(boundaryTime);
  return localMinutesOfDay(at, timezone) === hours * 60 + minutes;
}

export function isAtTimeMinute(timeStr: string, at: Date, timezone: string): boolean {
  const { hours, minutes } = parseBoundary(timeStr);
  return localMinutesOfDay(at, timezone) === hours * 60 + minutes;
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
