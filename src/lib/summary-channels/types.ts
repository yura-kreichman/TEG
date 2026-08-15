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

// Разбивка по активу для "Прибываний"/"Пусков" (accountingMode="stays"/
// "launches") — count+amount, без "было→стало" (у пусков нет непрерывного
// счётчика, только дискретные события) — тот же принцип, что readings[] у
// "Счётчиков" выше, но своя форма (запрос пользователя 2026-07-19: "в них
// нет Активов как мы делали в режиме Счётчики").
export interface ZoneAssetTallyLine {
  assetName: string;
  count: number;
  amount: number;
}

export interface ZoneSummaryData {
  // Сдачу правил Владелец — 👑 рядом с именем сотрудника (требование
  // владельца 2026-08-16: единый маркер правки во всех сообщениях Telegram).
  editedByOwner?: boolean;
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
  // Только у isGameRoom/"launches" — см. ZoneAssetTallyLine. Пустой массив
  // у "counters"/"cash_only" (там используется readings выше).
  perAsset: ZoneAssetTallyLine[];
  // Билеты (docs/spec/10-tickets.md) — accountingMode="tickets"; null у всех
  // остальных режимов, тот же принцип, что gameRoomLaunchCount выше.
  ticketsOrdersCount: number | null;
  ticketsCount: number | null;
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

/**
 * Что на точке не закрылось к границе бизнес-дня — сводка ушла по времени, а
 * не потому что там закончили. Пустой массив = обычная отправка.
 *
 * Пометка называет то, чего не хватает, а не последствие (решение
 * пользователя 2026-08-06: "типа Смены и сдачи итогов сегодня нет"): владелец
 * из этого сразу видит, что поправить. Прежнее "Принудительно — не все данные
 * могли поступить" не говорило ни что случилось, ни что делать.
 *
 * noSubmissions и zonesPending взаимоисключающи: либо сдач нет вовсе, либо
 * они есть, но не по всем зонам. "Сдач нет" при включённом тумблере "Не
 * отправлять без сдач" вообще недостижимо — сводка в такой день молчит.
 */
export type DailyCashPending = "openShift" | "noSubmissions" | "zonesPending";

export interface DailyCashSummaryData {
  pointName: string;
  // У тенанта больше одной точки — тогда название точки имеет смысл
  // показывать (запрос пользователя 2026-07-14: "если точка одна, не надо
  // писать её название вообще" — иначе это лишняя, ничего не говорящая
  // строка). Считается в daily-cash-data.ts по факту, не настройка.
  showPointName: boolean;
  // Календарная дата бизнес-дня (businessDateKey — полночь UTC уже
  // посчитанной локальной даты), а НЕ момент границы: при поздней границе
  // (22:00) день начинается в предыдущих сутках, и сводка писала вчерашнее
  // число. Форматировать только через formatBusinessDate.
  businessDate: Date;
  cashAmount: number;
  mobileAmount: number;
  // Абонемент как способ оплаты пуска — НЕ входит в cashAmount/mobileAmount
  // (касса точки уже получила эту сумму раньше, при пополнении абонемента,
  // не сегодня) — запрос пользователя 2026-07-17: "во всех отчётах и
  // сводках должны быть правильные цифры", "добавить Абонемент".
  abonementAmount: number;
  // Продажа абонементов (планов) за день, отдельно от abonementAmount выше
  // (та — трата с баланса) — запрос пользователя 2026-07-18: "в сводках в
  // Телеграм видна сумма проданных абонементов?" — не была, тот же разрыв,
  // что уже закрыт в Итогах дня/Отчётах/Остатках. Реальные деньги, не входит
  // ни в cashAmount/mobileAmount, ни в total ниже — это аванс клиента.
  abonementSold: { cash: number; mobile: number };
  expenses: number;
  // Премии/авансы, которые сотрудник САМ взял из кассы точки за день (запрос
  // пользователя 2026-07-17: "Премии+Авансы, которые взял Сотрудник") — не
  // "Расходы" бизнеса (то же разделение, что и в /api/reports/money), но
  // объясняет разницу между Итогом и Остатком, когда она есть.
  bonusesAndAdvances: number;
  zoneBreakdown: DailyCashZoneBreakdownLine[];
  cashOnHand: number;
  // См. DailyCashPending выше. Пустой массив — пометки в сводке нет.
  pending: DailyCashPending[];
}

export interface ShiftCloseSummaryData {
  // Смену или её аванс/премию правил Владелец — 👑 рядом с именем (см.
  // ZoneSummaryData.editedByOwner).
  editedByOwner?: boolean;
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
  /**
   * Премия начислена в баланс, а не выдана наличными (режим
   * Tenant.selfServicePayoutMode = "accrual", запрос пользователя
   * 2026-08-12). Меняет только подпись строки в сводке: владельцу важно
   * видеть, ушли деньги из кассы прямо сейчас или сотруднику записали долг.
   */
  bonusIsAccrual: boolean;
  toPayOut: number;
}

/**
 * Инкассация (запрос владельца 2026-08-16). Формат задан владельцем:
 *   🏦 ИНКАССАЦИЯ — 16/08, 00:30
 *   🟩 Женя: 1 500 ₽
 *   🎠 Машинки 700 ₽ · 🤸 Батуты 500 ₽ · 🛍 Товары 200 ₽ · 🎟 Абонементы 100 ₽
 * Авансовая инкассация (сотрудник сдал больше, чем было в кассе — берётся
 * вперёд) помечается прямо в шапке: "ИНКАССАЦИЯ (Аванс)".
 *
 * Строк разбивки может не быть вовсе (зонная инкассация одной зоны — тогда
 * там одна строка), а товары/абонементы появляются, только если из этих касс
 * что-то забрали.
 */
export interface CollectionAlertData {
  occurredAt: Date;
  // null — инкассацию проводил сам Владелец из кабинета; форматтер ставит 👑
  // вместо имени (тот же приём, что в остальных местах).
  operatorName: string | null;
  operatorColorTag: string | null;
  amount: number;
  isAdvance: boolean;
  zones: { name: string; emoji: string | null; amount: number }[];
  goodsAmount: number;
  abonementAmount: number;
  // Инкассацию правил Владелец — 👑 рядом с именем сотрудника.
  editedByOwner?: boolean;
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

// Новый расход, внесённый Сотрудником (запрос владельца 2026-08-15) — тоже
// не сводка, а мгновенное уведомление о действии: формат задан владельцем,
// состав не настраивается.
//   🛒 РАСХОД — 15/08, 22:46
//   🟩 Женя: 350 ₽
//   Выплата стажёру 🎠 Машинки
//   > комментарий сотрудника
// Третья строка — без подписей "категория"/"зона" (решение владельца): сами
// названия говорят за себя, а лишние слова съедают ширину Push-уведомления;
// разделитель между ними — эмодзи зоны, тот же Zone.telegramEmoji, что стоит
// в заголовке сводки по зоне. Категории может не быть — тогда строка
// начинается с эмодзи. Комментарий — только если сотрудник его написал.
// colorTag — цветовая метка карточки сотрудника (COLOR_TAG_PALETTE), тот же
// эмодзи-квадрат, что уже стоит рядом с именем в сводке закрытия смены.
export interface ExpenseAlertData {
  occurredAt: Date;
  operatorName: string;
  operatorColorTag: string | null;
  amount: number;
  categoryName: string | null;
  zoneName: string;
  zoneEmoji: string | null;
  comment: string | null;
  // Расход правил Владелец — тогда вместо цветовой метки сотрудника рядом с
  // его именем встаёт 👑 (запрос владельца 2026-08-16), тот же единый маркер
  // "это сделал Владелец", что иконка-корона в кабинете (PerformedByTag).
  // Имя вносившего при этом остаётся: кто потратил деньги — не меняется от
  // того, что запись потом поправили.
  editedByOwner: boolean;
}
