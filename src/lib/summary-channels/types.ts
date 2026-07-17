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
  // Прибывания (docs/spec/04-game-room.md) — accountingMode="stays"; сводке
  // нужен явный флаг, чтобы показать "Пусков: N · время: Xч Yм" вместо
  // блока показаний. count/minutes — null для всех остальных режимов.
  isGameRoom: boolean;
  gameRoomLaunchCount: number | null;
  gameRoomTotalMinutes: number | null;
  occurredAt: Date;
  readings: ZoneAssetReadingLine[];
  cashAmount: number;
  mobileAmount: number; // "безнал" — см. feedback_no_hardcoded_currency
  // Абонемент как способ оплаты пуска (docs/spec/04-game-room.md) — НЕ входит
  // в cashAmount/mobileAmount выше (касса уже получила эту сумму раньше, при
  // пополнении абонемента, а не сейчас), поэтому отдельное поле, не третье
  // слагаемое кассы (запрос пользователя 2026-07-17: "во всех отчётах и
  // сводках должны быть правильные цифры", "добавить Абонемент"). 0 у
  // "counters"/"cash_only" — там абонемент как способ оплаты не применим.
  abonementAmount: number;
  // Всегда валовая выручка по счётчикам (запрос пользователя 2026-07-16:
  // "счётчики должны показывать всегда факт") — сеансы × цена, БЕЗ вычета
  // возвратов/тестов. Разница (difference) при этом по-прежнему считается
  // от net-выручки, так что может быть 0 даже когда calculatedRevenue
  // визуально не равен кассе — тесты объясняют разрыв, см. returnsCount.
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
  // Справочно, не входит в revenue выше (запрос пользователя 2026-07-17—
  // см. abonementAmount в DailyCashSummaryData ниже).
  abonementAmount: number;
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
  // Абонемент как способ оплаты пуска — НЕ входит в cashAmount/mobileAmount
  // (касса точки уже получила эту сумму раньше, при пополнении абонемента,
  // не сегодня) — запрос пользователя 2026-07-17: "во всех отчётах и
  // сводках должны быть правильные цифры", "добавить Абонемент".
  abonementAmount: number;
  expenses: number;
  // Премии/авансы, которые сотрудник САМ взял из кассы точки за день (запрос
  // пользователя 2026-07-17: "Премии+Авансы, которые взял Сотрудник") — не
  // "Расходы" бизнеса (то же разделение, что и в /api/reports/money), но
  // объясняет разницу между Итогом и Остатком, когда она есть.
  bonusesAndAdvances: number;
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
