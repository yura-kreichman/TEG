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
  // Игровая комната (docs/spec/04-game-room.md) — суб-режим "launches"
  // (Zone.launchMode="game_room"), не отдельный ZoneAccountingMode; сводке
  // нужен явный флаг, чтобы показать "Пусков: N · время: Xч Yм" вместо
  // блока показаний. count/minutes — null для всех остальных режимов.
  isGameRoom: boolean;
  gameRoomLaunchCount: number | null;
  gameRoomTotalMinutes: number | null;
  occurredAt: Date;
  readings: ZoneAssetReadingLine[];
  cashAmount: number;
  mobileAmount: number; // "безнал" — см. feedback_no_hardcoded_currency
  calculatedRevenue: number;
  // Валовая выручка по счётчикам ДО вычета возвратов/тестов (запрос
  // пользователя 2026-07-16, реальный кейс: 33 сеанса по счётчикам, 8 тестов,
  // calculatedRevenue уже net — без этого поля непонятно, откуда взялась
  // разница в 0 при ненулевых тестах). null для cash_only/game_room, где
  // валовой цифры по счётчикам не существует.
  grossRevenue: number | null;
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
  // У тенанта больше одной точки — тогда название точки имеет смысл
  // показывать (запрос пользователя 2026-07-14: "если точка одна, не надо
  // писать её название вообще" — иначе это лишняя, ничего не говорящая
  // строка). Считается в daily-cash-data.ts по факту, не настройка.
  showPointName: boolean;
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
