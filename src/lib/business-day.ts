// Бизнес-день с произвольной границей (по умолчанию 06:00) — сдачи/смены до
// этого часа относятся к предыдущему дню (docs/spec/telegram-summaries.md,
// "Касса за день"). Граница вводится Владельцем в часовом поясе тенанта
// (Tenant.timezone), поэтому вся арифметика ниже — в этом часовом поясе, не
// в сыром UTC сервера (РЕАЛЬНЫЙ БАГ, найден 2026-07-12 при аудите перед
// запуском — тот же класс, что уже чинили для isWithinShiftStartWindow
// 2026-07-12 раньше; тогда сознательно не трогали getBusinessDayBounds/
// isAtBoundaryMinute/isAtTimeMinute как "более рискованный кусок логики" —
// аудит перед реальным запуском был поводом наконец это закрыть).

export function parseBoundary(boundaryTime: string): { hours: number; minutes: number } {
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

/**
 * Бизнес-день, которому принадлежит момент `at` при данной границе, в
 * часовом поясе `timezone`.
 *
 * Соседний день считается через zonedWallTimeToUtc с ПЕРЕСЧИТАННЫМИ Y/M/D
 * (Date.UTC(...day±1) корректно переносит через границу месяца/года), НЕ
 * через ±24ч в миллисекундах (аудит 2026-07-27, второй раунд, реальный
 * денежный баг — этот файл сам предупреждал в шапке, что при первом аудите
 * 2026-07-12 эту часть сознательно отложили как "более рискованный кусок
 * логики"). Простое ±24ч верно только вне перехода на/с летнего времени —
 * в день перехода реальная длина суток 23 или 25 часов, а не 24: соседняя
 * граница получалась сдвинутой на час относительно настоящей стенной
 * границы этого дня, и час активности либо выпадал из ОБОИХ соседних окон
 * [start,end), либо попадал в оба сразу — раз в год выручка/сдачи итогов
 * пропадали или задваивались в дневных сводках "Касса за день". Тот же
 * приём, что уже использует dayBoundsUtc (эта же функция файла).
 */
export function getBusinessDayBounds(boundaryTime: string, at: Date, timezone: string): { start: Date; end: Date } {
  const { hours, minutes } = parseBoundary(boundaryTime);
  const { year, month, day } = localDateParts(at, timezone);
  const boundaryToday = zonedWallTimeToUtc(year, month, day, hours, minutes, timezone);

  function boundaryForDayOffset(offset: number): Date {
    const d = new Date(Date.UTC(year, month - 1, day + offset));
    return zonedWallTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hours, minutes, timezone);
  }

  const start = at >= boundaryToday ? boundaryToday : boundaryForDayOffset(-1);
  const end = at >= boundaryToday ? boundaryForDayOffset(1) : boundaryToday;
  return { start, end };
}

/**
 * Бизнес-день, предшествующий данному. Через момент "за миллисекунду до
 * начала", а НЕ через минус 24 часа: в день перехода на/с летнего времени
 * сутки длятся 23 или 25 часов, и вычитание 24ч сдвигало бы границу на час
 * (тот же класс бага, что уже разобран в комментарии к getBusinessDayBounds).
 */
export function previousBusinessDayBounds(
  boundaryTime: string,
  bounds: { start: Date },
  timezone: string
): { start: Date; end: Date } {
  return getBusinessDayBounds(boundaryTime, new Date(bounds.start.getTime() - 1), timezone);
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

/**
 * [start, end) календарного дня year/month/day в часовом поясе тенанта —
 * midnight-to-midnight ПО МЕСТУ, не сырой UTC-полночи сервера (тот же приём,
 * что уже вручную дублировался в reports/money/route.ts: Date.UTC(...) для
 * безопасного календарного переноса через границу месяца/года, затем
 * zonedWallTimeToUtc для перевода этой стенной полуночи в момент UTC).
 *
 * НЕ путать с getBusinessDayBounds выше — это отдельная, самостоятельная
 * концепция (граница дня в 06:00 для Telegram "Касса за день"/рабочего
 * времени). dayBoundsUtc — обычный календарный день тенанта, используется
 * report-роутами (Итоги дня, Главная, календари), где "день" уже давно
 * означает calendar day, не бизнес-день (аудит 2026-07-24: часть этих
 * роутов ошибочно бакетировала по СЫРОМУ UTC серверу вместо календарного дня
 * тенанта — тот же класс бага, что уже чинили для getPeriodRange, просто в
 * соседних не полученных этим фиксом файлах, из-за чего одна и та же
 * операция могла попадать на РАЗНЫЕ числа на разных экранах владельца).
 */
export function dayBoundsUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
  // Граница дня тенанта (решение пользователя 2026-08-06). "00:00" — обычный
  // календарный день, как было всегда; у тенантов, работающих после полуночи,
  // здесь стоит утренний час, и тогда день year/month/day идёт ОТ этого часа
  // этой даты ДО того же часа следующей.
  //
  // Зачем это вообще: касса и показания снимаются ОДИН раз за смену, разложить
  // их по часам нечем. У точки, закрывающейся в три ночи, календарный день
  // отправлял весь вечер в следующую дату — суббота пустая, воскресенье
  // двойное, сверка кассы превращалась в мусор (выручка без кассы в одном дне,
  // касса без выручки в другом).
  boundaryTime = "00:00"
): { start: Date; end: Date } {
  const { hours, minutes } = parseBoundary(boundaryTime);
  const start = zonedWallTimeToUtc(year, month, day, hours, minutes, timezone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = zonedWallTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    hours,
    minutes,
    timezone
  );
  return { start, end };
}

/**
 * Какому дню принадлежит момент `at` при данной границе — для раскладки строк
 * по клеткам календаря и группировок "по дням". Пара к dayBoundsUtc выше:
 * `businessDayOf` отвечает "в какую клетку", `dayBoundsUtc` — "какое окно у
 * этой клетки", и они обязаны отвечать согласованно.
 *
 * Раньше календари звали localDateParts напрямую, то есть всегда считали
 * календарный день, даже когда окно дня было другим.
 */
export function businessDayOf(
  at: Date,
  timezone: string,
  boundaryTime = "00:00"
): { year: number; month: number; day: number } {
  const bounds = getBusinessDayBounds(boundaryTime, at, timezone);
  // Полночь UTC уже посчитанной локальной даты -> обратно в Y/M/D. Читаем
  // через businessDateKey, а не localDateParts(bounds.start), чтобы сдвиг на
  // 12 часов внутрь окна (и весь его разбор в комментарии к businessDateKey)
  // жил в одном месте.
  const key = businessDateKey(bounds, timezone);
  return { year: key.getUTCFullYear(), month: key.getUTCMonth() + 1, day: key.getUTCDate() };
}

/**
 * [from, to) для пары дат "YYYY-MM-DD" из query-параметров экрана (фильтр
 * неделя/месяц) — в календаре тенанта, обе даты включительно.
 *
 * Заведено 2026-08-02: роуты Рабочего времени (табель и сводка, владельца и
 * оператора) разворачивали эти параметры в СЫРУЮ UTC-полночь
 * (`new Date(\`${from}T00:00:00.000Z\`)`) — ровно тот класс бага, который
 * аудит 2026-07-24 уже вычистил из report-роутов через dayBoundsUtc, но эти
 * четыре тогда не попали в проход. Для тенанта восточнее UTC (все текущие —
 * Europe/Chisinau и Europe/Moscow, +3) смена, начатая между полуночью и
 * тремя часами ночи по месту, в UTC приходится ещё на предыдущие сутки и
 * попадала в табель ПРЕДЫДУЩЕГО месяца. Для точек, работающих ночью, это не
 * теория: businessDayBoundary у части тенантов выставлена на 01:00 и 22:00.
 */
export function periodBoundsUtc(
  fromDate: string,
  toDate: string,
  timezone: string,
  boundaryTime = "00:00"
): { from: Date; to: Date } {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return {
    from: dayBoundsUtc(fy!, fm!, fd!, timezone, boundaryTime).start,
    // .end — граница СЛЕДУЮЩЕГО местного дня: та же семантика "по toDate
    // включительно", что была у прежнего "+24 часа", но корректная и в день
    // перехода на/с летнего времени, когда сутки длятся 23 или 25 часов.
    to: dayBoundsUtc(ty!, tm!, td!, timezone, boundaryTime).end,
  };
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
