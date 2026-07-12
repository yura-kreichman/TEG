// Структурированные данные сводок — общие для всех каналов (docs/spec/telegram-summaries.md,
// Шаг 3.5: "каждый адаптер получает структурированные данные и форматирует сам").
// Никакого I/O здесь — только формы данных, которые собирают триггеры и
// потребляют форматтеры каналов. Это то, что делает форматтеры тестируемыми
// без реального Telegram/SMTP: даёшь такой объект — получаешь текст.

import type { ZoneAccountingMode } from "@/lib/results-calc";

export interface ZoneAssetReadingLine {
  assetName: string;
  tariffName: string;
  reading: number;
  delta: number;
}

export interface ZoneSummaryData {
  pointName: string;
  zoneName: string;
  // Zone.telegramEmoji — Unicode-эмодзи в заголовке Telegram-сводки, выбран
  // владельцем отдельно от SVG-иконки (фидбек пользователя 2026-07-12).
  // null — telegram-format.ts подставляет 🏁 по умолчанию.
  zoneEmoji: string | null;
  accountingMode: ZoneAccountingMode;
  occurredAt: Date;
  readings: ZoneAssetReadingLine[];
  cashAmount: number;
  mobileAmount: number; // "безнал" — см. feedback_no_hardcoded_currency
  calculatedRevenue: number;
  difference: number;
  returnsCount: number;
  operatorName: string;
  // См. ShiftCloseSummaryData.operatorColorTag — тот же квадратный эмодзи
  // рядом с именем оператора, здесь в первой строке сводки (фидбек
  // пользователя 2026-07-12: "имя оператора должно быть в первой строке").
  operatorColorTag: string | null;
}

export interface DailyCashZoneBreakdownLine {
  zoneName: string;
  revenue: number;
}

export interface DailyCashSummaryData {
  pointName: string;
  businessDate: Date; // полночь UTC начала бизнес-дня
  cashAmount: number;
  mobileAmount: number;
  expenses: number;
  zoneBreakdown: DailyCashZoneBreakdownLine[];
  cashOnHand: number;
  // Предохранитель: смены/операторы, чья активность не укладывается в
  // ожидаемое завершение дня (см. открытый вопрос в чате про "открытые смены").
  forcedIncomplete: boolean;
}

export interface ShiftCloseSummaryData {
  operatorName: string;
  // Цветовая метка оператора (Operator.colorTag, #rrggbb) — telegram-format.ts
  // показывает соответствующий эмодзи цветного квадрата рядом с именем
  // (фидбек пользователя 2026-07-12). null, если метка не назначена.
  operatorColorTag: string | null;
  startAt: Date;
  endAt: Date;
  minutes: number;
  rate: number;
  accrued: number;
  advanceAmount: number;
  bonusAmount: number;
  toPayOut: number;
}

export interface ChannelSendResult {
  ok: boolean;
  error?: string;
  externalMessageId?: string;
}

// Модуль Инструктажи (docs/spec/07-instructions.md, "Уведомления") — не
// тип сводки как остальные (нет per-type ZoneSummarySettings-аналога, нет
// компактного/детального режима) — одно простое сообщение на каждое
// подписание, по всем включённым каналам без отдельного тумблера типа.
export interface InstructionAckData {
  fullName: string;
  instructionTitle: string;
  readingMinutes: number;
}
