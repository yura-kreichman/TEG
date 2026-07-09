// "event" (когда на точке не остаётся открытых смен) | "fixed" (в заданное
// время каждый день) — режим отправки сводки "Касса за день". Открытый набор
// строкой, не Prisma enum, по тому же принципу, что ZoneAccountingMode
// (src/lib/results-calc.ts) — единственный источник правды для проверки и
// на бэке, и на фронте.
export const DAILY_CASH_SEND_MODES = ["event", "fixed"] as const;
export type DailyCashSendMode = (typeof DAILY_CASH_SEND_MODES)[number];

export function isDailyCashSendMode(value: unknown): value is DailyCashSendMode {
  return typeof value === "string" && (DAILY_CASH_SEND_MODES as readonly string[]).includes(value);
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeString(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

export interface ZoneSummarySettingsData {
  enabled: boolean;
  showReadings: boolean;
  showDelta: boolean;
  showCash: boolean;
  showCalc: boolean;
  showDiff: boolean;
  showReturns: boolean;
  showOperator: boolean;
}

export const ZONE_SUMMARY_DEFAULTS: ZoneSummarySettingsData = {
  enabled: true,
  showReadings: true,
  showDelta: true,
  showCash: true,
  showCalc: true,
  showDiff: true,
  showReturns: true,
  showOperator: false,
};

export interface DailyCashSummarySettingsData {
  enabled: boolean;
  sendMode: DailyCashSendMode;
  fixedTime: string;
  businessDayBoundary: string;
  skipIfNoSubmissions: boolean;
  updateOnLateSubmission: boolean;
  showCash: boolean;
  showExpenses: boolean;
  showZoneBreakdown: boolean;
  showCashOnHand: boolean;
}

export const DAILY_CASH_SUMMARY_DEFAULTS: DailyCashSummarySettingsData = {
  enabled: true,
  sendMode: "event",
  fixedTime: "23:00",
  businessDayBoundary: "06:00",
  skipIfNoSubmissions: true,
  updateOnLateSubmission: true,
  showCash: true,
  showExpenses: true,
  showZoneBreakdown: false,
  showCashOnHand: false,
};

export interface ShiftCloseSummarySettingsData {
  enabled: boolean;
  showPeriod: boolean;
  showHours: boolean;
  showAdvance: boolean;
  showBonus: boolean;
  showTotal: boolean;
}

export const SHIFT_CLOSE_SUMMARY_DEFAULTS: ShiftCloseSummarySettingsData = {
  enabled: true,
  showPeriod: true,
  showHours: false,
  showAdvance: true,
  showBonus: true,
  showTotal: true,
};
