// Общие для сервера и клиента правила расчёта из docs/spec/01-counters.md.

// Режим учёта зоны — открытый список, как MoneyOperation.type (см. "Режим учёта
// зоны" в 01-counters.md). Валидируется через этот массив на сервере и клиенте.
export const ZONE_ACCOUNTING_MODES = ["counters", "launches", "cash_only"] as const;
export type ZoneAccountingMode = (typeof ZONE_ACCOUNTING_MODES)[number];

export function isZoneAccountingMode(value: unknown): value is ZoneAccountingMode {
  return typeof value === "string" && (ZONE_ACCOUNTING_MODES as readonly string[]).includes(value);
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
