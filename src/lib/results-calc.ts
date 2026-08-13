// Общие для сервера и клиента правила расчёта из docs/spec/01-counters.md.

// Режим учёта зоны — открытый список, как MoneyOperation.type (см. "Режим учёта
// зоны" в 01-counters.md). Валидируется через этот массив на сервере и клиенте.
// "stays" (Прибывания, docs/spec/04-game-room.md) — самостоятельный режим,
// РЯДОПОЛОЖНЫЙ остальным (решение пользователя 2026-07-17; было
// суб-режимом "launches" до этого — пересмотрено). "tickets" (Билеты,
// docs/spec/10-tickets.md) — пятый рядоположный режим, добавлен 2026-07-22.
// "cash_only" — последним (запрос пользователя 2026-07-22: "самый не
// популярный" режим), остальной порядок — по частоте использования.
export const ZONE_ACCOUNTING_MODES = ["counters", "launches", "stays", "tickets", "cash_only"] as const;
export type ZoneAccountingMode = (typeof ZONE_ACCOUNTING_MODES)[number];

export function isZoneAccountingMode(value: unknown): value is ZoneAccountingMode {
  return typeof value === "string" && (ZONE_ACCOUNTING_MODES as readonly string[]).includes(value);
}

export function isStaysZone(zone: { accountingMode: string }): boolean {
  return zone.accountingMode === "stays";
}

export function isLaunchesZone(zone: { accountingMode: string }): boolean {
  return zone.accountingMode === "launches";
}

export function isTicketsZone(zone: { accountingMode: string }): boolean {
  return zone.accountingMode === "tickets";
}

export function isCountersZone(zone: { accountingMode: string }): boolean {
  return zone.accountingMode === "counters";
}

// "Счётчики" с включённым Zone.countersTapAssistEnabled (запрос пользователя
// 2026-07-25) — accountingMode остаётся "counters" (формула расчёта та же),
// но, как и у launches/stays/tickets, мастер сдачи итогов НЕ просит
// показания вручную — сервер сам считает их из журнала CounterTapEvent (см.
// submit-results/route.ts). Отдельная функция, не значение accountingMode —
// это флаг ИСТОЧНИКА числа, не отдельный режим.
export function isCountersTapAssistZone(zone: { accountingMode: string; countersTapAssistEnabled?: boolean }): boolean {
  return isCountersZone(zone) && zone.countersTapAssistEnabled === true;
}

// Зона, для которой мастер сдачи итогов НЕ показывает шаг ручного ввода
// показаний — общий помощник вместо повторяемого
// "isStaysZone(zone) || isLaunchesZone(zone)" по всему submit/page.tsx,
// расширенный тапами Счётчиков (запрос пользователя 2026-07-25).
export function skipsManualReadingsStep(zone: { accountingMode: string; countersTapAssistEnabled?: boolean }): boolean {
  return isStaysZone(zone) || isLaunchesZone(zone) || isCountersTapAssistZone(zone);
}

/**
 * Сколько из расчётной выручки "Счётчиков" уже оплачено балансом абонемента —
 * эту часть надо вычесть из выручки ПЕРЕД сравнением с фактической кассой,
 * иначе Разница показывает фиктивную недостачу ровно на сумму баланса: деньги
 * за неё пришли раньше, при пополнении абонемента, и в кассу этой сдачи
 * попасть не могли (тот же принцип, что у Пусков/Прибываний/Билетов —
 * их difference прибавляет abonementAmount с 2026-07-18).
 *
 * Разные источники числа у двух видов зон — не мелочь, а суть:
 * - TAP-зона: netRevenue считается из тапов В ПРИЛОЖЕНИИ, поэтому вычитать
 *   можно только оплату, привязанную к КОНКРЕТНОМУ тапу (`tapLinked`).
 *   Списание через "Списать с баланса" тапа не создаёт, в netRevenue его нет —
 *   вычесть его значило бы показать фиктивный излишек.
 * - Ручные "Счётчики": netRevenue считается из МЕХАНИЧЕСКОГО счётчика, а он
 *   крутится от самой поездки и про способ оплаты не знает вовсе. Значит в
 *   netRevenue попадает КАЖДАЯ оплата балансом по этой зоне (`zoneSpend`).
 *
 * До 2026-08-13 у ручных зон здесь возвращался 0 — по правилу 2026-07-25
 * "decoupled списание не связано ни с каким сеансом". Реальный день на проде
 * (КидсБург, «Машинки», 6 списаний на 455 за смену) показал, что связано:
 * Сотрудник списывает с баланса именно за поездку, счётчик её считает, и
 * Разница выходила −455 на ровном месте. Спека (docs/spec/01-counters.md,
 * "Расчёт") описывает разницу как "касса − расчётная выручка" и про оплату
 * балансом молчит вовсе — её надо дополнить этим правилом.
 */
export function countersPaidFromBalance(
  zone: { accountingMode: string; countersTapAssistEnabled?: boolean },
  amounts: { zoneSpend: number; tapLinked: number }
): number {
  if (!isCountersZone(zone)) return 0;
  return isCountersTapAssistZone(zone) ? amounts.tapLinked : amounts.zoneSpend;
}

// Счётчики 4-разрядные (0-9999), переполнение 9999→0 — разница считается по модулю 10000.
export const COUNTER_MOD = 10000;

export function calcSessions(currentReading: number, previousReading: number): number {
  return ((currentReading - previousReading) % COUNTER_MOD + COUNTER_MOD) % COUNTER_MOD;
}

export interface TariffCalcInput {
  tariffId: string;
  price: number;
  sessions: number;
}

/**
 * Валовая выручка зоны по счётчикам = Σ по тарифам: сеансы × цена, БЕЗ вычета
 * возвратов/тестов (запрос пользователя 2026-07-16: "по счётчикам должно
 * быть больше" — иначе непонятно, откуда взялась разница в 0 при ненулевых
 * тестах). Только для отображения рядом с calcZoneRevenue — в сравнении с
 * кассой участвует по-прежнему только net-выручка (calcZoneRevenue).
 */
export function calcZoneGrossRevenue(tariffs: TariffCalcInput[]): number {
  const total = tariffs.reduce((sum, t) => sum + t.sessions * t.price, 0);
  return Math.round(total * 100) / 100;
}

/** Расчётная выручка зоны = Σ по тарифам: (сеансы − возвраты/тесты) × цена. */
export function calcZoneRevenue(tariffs: TariffCalcInput[], returnsCount: number): number {
  // Возвраты/тесты — общее число на зону, а не на тариф; вычитаем один раз из
  // суммарных сеансов, а не из каждого тарифа отдельно, чтобы не задваивать вычет.
  const totalSessions = tariffs.reduce((sum, t) => sum + t.sessions, 0);
  const netSessions = Math.max(totalSessions - returnsCount, 0);
  const totalRevenueBeforeReturns = tariffs.reduce((sum, t) => sum + t.sessions * t.price, 0);
  if (totalSessions === 0) return 0;
  // Пропорционально распределяем вычет возвратов между тарифами по их доле
  // сеансов, чтобы формула оставалась одной суммой, а не произвольным выбором,
  // с какого тарифа списывать возвраты.
  const ratio = netSessions / totalSessions;
  return Math.round(totalRevenueBeforeReturns * ratio * 100) / 100;
}
