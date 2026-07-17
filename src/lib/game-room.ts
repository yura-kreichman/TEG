// Модуль "Прибывания" (docs/spec/04-game-room.md) — чистая расчётная
// логика и общие для бэкенд-роутов операции с пусками. Отдельно от
// results-calc.ts (тот — про counters/launches/cash_only/stays как режимы
// учёта), потому что расчёт здесь принципиально другой: не от показаний/
// введённого итога, а от агрегата реальных старт/стоп записей.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

export const LAUNCH_PRICING_MODES = ["fixed", "per_minute"] as const;
export type LaunchPricingMode = (typeof LAUNCH_PRICING_MODES)[number];

export const LAUNCH_ROUNDING_MODES = ["up", "down", "nearest"] as const;
export type LaunchRoundingMode = (typeof LAUNCH_ROUNDING_MODES)[number];

// Способ оплаты — только у "per_minute"/"По факту" (запрос пользователя
// 2026-07-17), спрашивается у оператора при остановке пуска.
export const LAUNCH_PAYMENT_METHODS = ["cash", "mobile"] as const;
export type LaunchPaymentMethod = (typeof LAUNCH_PAYMENT_METHODS)[number];

// Ограничение на число одновременно открытых пусков одного актива/зоны
// (docs/spec/04-game-room.md, Шаг 3: "лимит разумного числа параллельных на
// актив — предложи значение"). 50 — с запасом над реальным тестовым кейсом
// в 20 параллельных пусков (батутная арена), но не бесконечность: явная
// защита от зависшего клиента, который спамит старт без остановки.
export const MAX_PARALLEL_LAUNCHES = 50;

export interface LaunchPricingSnapshot {
  pricingMode: LaunchPricingMode;
  priceSnapshot: Prisma.Decimal | number;
  durationMinutesSnapshot: number | null;
  roundingModeSnapshot: LaunchRoundingMode | null;
  minAmountSnapshot: Prisma.Decimal | number | null;
}

/**
 * Действующий тариф АКТИВА — тариф ЗОНЫ (Tariff, та же сущность и тот же
 * лимит, что у counters/launches), на который ссылается Asset.tariffId
 * (запрос пользователя 2026-07-17: тарифы и активы создаются независимо,
 * владелец сам привязывает один к другому — было наоборот, Tariff.assetId,
 * пересмотрено). null, если у актива ещё не выбран тариф, или выбранный
 * тариф удалён (soft-delete).
 */
export async function getAssetTariff(assetId: string, tx: Tx | typeof prisma = prisma) {
  const asset = await tx.asset.findUnique({ where: { id: assetId }, select: { tariffId: true } });
  if (!asset?.tariffId) return null;
  return tx.tariff.findFirst({
    where: { id: asset.tariffId, deletedAt: null },
  });
}

/**
 * Наименьшее положительное целое, отсутствующее среди переданных — номер
 * браслета (запрос пользователя 2026-07-17: "если активные 1, 2, 3, то после
 * освобождения 2 следующему присваивается 2" — переиспользование, а не
 * бесконечный рост). Чистая функция, отдельно от БД-обёртки ниже — тестируется
 * без Prisma.
 */
export function smallestFreeNumber(usedNumbers: Iterable<number>): number {
  const used = new Set(usedNumbers);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * Номер браслета для следующего пуска — наименьший свободный СРЕДИ ОТКРЫТЫХ
 * пусков этого актива (запрос пользователя 2026-07-17: "отдельный пул
 * браслетов на каждый актив" — тот же номер вполне может быть одновременно
 * активен на другом активе). Атомарно через advisory-lock транзакции (не
 * через @@unique — Launch.assetId используется как lock key напрямую, без
 * зоны). Лок держится до конца транзакции tx и сам снимается коммитом/
 * роллбэком — вызывающий код обязан вызывать это внутри prisma.$transaction.
 */
export async function nextLaunchNumber(tx: Tx, assetId: string): Promise<number> {
  // $executeRaw, не $queryRaw — pg_advisory_xact_lock() возвращает void,
  // адаптер @prisma/adapter-pg падает при попытке десериализовать пустую
  // колонку через $queryRaw ("Failed to deserialize column of type 'void'",
  // реальная ошибка 2026-07-17 при первом живом старте пуска). Возврат не
  // нужен — важен только побочный эффект (лок до конца транзакции).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assetId}))`;
  const open = await tx.launch.findMany({
    where: { assetId, isOpen: true },
    select: { number: true },
  });
  return smallestFreeNumber(open.map((l) => l.number));
}

export async function countOpenLaunches(assetId: string, tx: Tx | typeof prisma = prisma) {
  return tx.launch.count({ where: { assetId, isOpen: true } });
}

/**
 * Зона доступна оператору для операций с пусками — та же проверка, что уже
 * используется для мастера сдачи итогов (submission-context/route.ts):
 * своя точка + (доступ ко всем зонам ИЛИ зона в allowedZones).
 */
export async function findOperatorStaysZone(
  zoneId: string,
  pointId: string,
  operator: { id: string; allZonesAccess: boolean }
) {
  return prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId,
      active: true,
      accountingMode: "stays",
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    include: { assets: true },
  });
}

/**
 * Зона доступна оператору для тапа пусков "Пуски" (accountingMode="launches",
 * запрос пользователя 2026-07-17: "тапали по активам и пуски учитывались" —
 * цифровая замена бумажной тетрадки с плюсиками). Та же проверка доступа,
 * что у findOperatorStaysZone — своя точка + (доступ ко всем зонам ИЛИ зона
 * в allowedZones). Тарифы зоны нужны сразу (до 2, оператор выбирает на
 * каждом пуске — тариф не привязан к активу заранее, в отличие от stays).
 */
export async function findOperatorLaunchesZone(
  zoneId: string,
  pointId: string,
  operator: { id: string; allZonesAccess: boolean }
) {
  return prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId,
      active: true,
      accountingMode: "launches",
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    include: { assets: true, tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
  });
}

/** Для мягкой блокировки сдачи итогов — открытые пуски по всей зоне, любой актив. */
export async function countOpenLaunchesInZone(zoneId: string, tx: Tx | typeof prisma = prisma) {
  return tx.launch.count({ where: { zoneId, isOpen: true } });
}

function roundMinutes(rawMinutes: number, mode: LaunchRoundingMode): number {
  if (mode === "up") return Math.ceil(rawMinutes);
  if (mode === "down") return Math.floor(rawMinutes);
  return Math.round(rawMinutes);
}

/**
 * Стоимость пуска при закрытии — по снапшоту тарифа на момент старта, не по
 * текущему тарифу зоны (docs/spec/04-game-room.md, "Пуск"). fixed — фикс.
 * цена вне зависимости от факт. длительности (длительность там только для
 * напоминания оператору, не для расчёта). per_minute — округлённые минуты ×
 * тариф, не ниже минималки.
 */
export function computeLaunchAmount(
  pricing: LaunchPricingSnapshot,
  startedAt: Date,
  endedAt: Date
): number {
  if (pricing.pricingMode === "fixed") {
    return Number(pricing.priceSnapshot);
  }

  // Округление — всегда вверх (запрос пользователя 2026-07-16: округление
  // вниз/математически недодаёт точке выручку за фактически занятое время);
  // fallback на случай null в старых записях, не сам выбор.
  const rawMinutes = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60000);
  const mode = pricing.roundingModeSnapshot ?? "up";
  const minutes = roundMinutes(rawMinutes, mode);
  const amount = minutes * Number(pricing.priceSnapshot);
  const minAmount = pricing.minAmountSnapshot != null ? Number(pricing.minAmountSnapshot) : 0;
  return Math.max(amount, minAmount);
}

export interface GameRoomAggregate {
  count: number;
  totalAmount: number;
  totalMinutes: number;
  launchIds: string[];
  // Разбивка totalAmount по способу оплаты — только у "per_minute"/"По
  // факту" (у "fixed"/"За вход" paymentMethod не спрашивается, эти суммы в
  // разбивку не попадают, поэтому cashAmount+mobileAmount может быть МЕНЬШЕ
  // totalAmount — это ожидаемо). Чисто справочная величина: НЕ подставляется
  // в поля кассы шага 4 мастера сдачи итогов (запрос пользователя
  // 2026-07-17: подстановка стёрла бы контроль недостачи через "Разницу").
  cashAmount: number;
  mobileAmount: number;
}

/**
 * Агрегат завершённых, не аннулированных пусков зоны за период (docs/spec/
 * 04-game-room.md, "Деньги и сдача итогов") — используется и для расчётной
 * выручки в мастере сдачи итогов, и для карточки владельца/сводки.
 * `since` исключается (>), `until` включается (<=) — окно "с момента
 * предыдущей сдачи по текущий момент".
 */
export async function aggregateGameRoomLaunches(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<GameRoomAggregate> {
  const launches = await tx.launch.findMany({
    where: {
      zoneId,
      voidedAt: null,
      endedAt: { not: null, lte: until, ...(since ? { gt: since } : {}) },
    },
    select: { id: true, amount: true, startedAt: true, endedAt: true, paymentMethod: true },
  });

  let totalAmount = 0;
  let totalMinutes = 0;
  let cashAmount = 0;
  let mobileAmount = 0;
  for (const l of launches) {
    const amount = Number(l.amount ?? 0);
    totalAmount += amount;
    if (l.endedAt) totalMinutes += (l.endedAt.getTime() - l.startedAt.getTime()) / 60000;
    if (l.paymentMethod === "cash") cashAmount += amount;
    else if (l.paymentMethod === "mobile") mobileAmount += amount;
  }

  return {
    count: launches.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalMinutes: Math.round(totalMinutes),
    launchIds: launches.map((l) => l.id),
    cashAmount: Math.round(cashAmount * 100) / 100,
    mobileAmount: Math.round(mobileAmount * 100) / 100,
  };
}

export interface AssetRevenueBreakdown {
  assetId: string;
  // Расчётная выручка этого актива (сумма amount всех завершённых пусков,
  // "За вход" и "По факту" вместе) — показывается оператору READ-ONLY в
  // мастере сдачи итогов рядом с полем, куда он вносит реально собранную
  // сумму (запрос пользователя 2026-07-17: "внутри актива... сумма
  // расчётная как read only и сотрудник вносит реальные суммы — так мы
  // узнаем есть ли разница").
  calculatedAmount: number;
  // Тот же итог, разложенный по способу оплаты, которую оператор указал по
  // каждому браслету (при старте — "За вход", при остановке — "По факту",
  // см. paymentMethod у Launch) — чисто справочно, помогает быстрее
  // вспомнить реальную сумму, не подставляется в поля автоматически.
  cashAmount: number;
  mobileAmount: number;
}

/**
 * Расчётная выручка "Прибываний" по каждому активу зоны отдельно (запрос
 * пользователя 2026-07-17: "должны отображаться Активы... по аналогии как
 * и со счётчиками") — зона может держать несколько активов, сваленные в
 * один общий итог были бы менее полезны оператору, физически считающему
 * кассу по каждому активу отдельно. Пропускает активы без завершённых
 * пусков в этом окне (нечего показать).
 */
export async function gameRoomRevenueByAsset(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<AssetRevenueBreakdown[]> {
  const launches = await tx.launch.findMany({
    where: {
      zoneId,
      voidedAt: null,
      endedAt: { not: null, lte: until, ...(since ? { gt: since } : {}) },
    },
    select: { assetId: true, amount: true, paymentMethod: true },
  });

  const byAsset = new Map<string, { calculatedAmount: number; cashAmount: number; mobileAmount: number }>();
  for (const l of launches) {
    if (!l.assetId) continue;
    const bucket = byAsset.get(l.assetId) ?? { calculatedAmount: 0, cashAmount: 0, mobileAmount: 0 };
    const amount = Number(l.amount ?? 0);
    bucket.calculatedAmount += amount;
    if (l.paymentMethod === "cash") bucket.cashAmount += amount;
    else if (l.paymentMethod === "mobile") bucket.mobileAmount += amount;
    byAsset.set(l.assetId, bucket);
  }

  return Array.from(byAsset.entries()).map(([assetId, { calculatedAmount, cashAmount, mobileAmount }]) => ({
    assetId,
    calculatedAmount: Math.round(calculatedAmount * 100) / 100,
    cashAmount: Math.round(cashAmount * 100) / 100,
    mobileAmount: Math.round(mobileAmount * 100) / 100,
  }));
}

export interface LaunchTallyEntry {
  assetId: string;
  tariffId: string;
  count: number;
  amount: number;
}

/**
 * Пуски "Пуски" (accountingMode="launches") с момента предыдущей сдачи —
 * по каждой паре актив+тариф отдельно (запрос пользователя 2026-07-17:
 * тариф не привязан к активу заранее, один и тот же актив держит пуски по
 * ОБОИМ тарифам зоны, как сейчас показания по обоим тарифам на актив в
 * counters/launches). `count` — то самое число "заездов", которое раньше
 * оператор вписывал вручную; здесь оно собирается из реальных тапов.
 */
export async function launchesRevenueByAssetAndTariff(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<LaunchTallyEntry[]> {
  const launches = await tx.launch.findMany({
    where: {
      zoneId,
      voidedAt: null,
      endedAt: { not: null, lte: until, ...(since ? { gt: since } : {}) },
    },
    select: { assetId: true, tariffId: true, amount: true },
  });

  const byKey = new Map<string, LaunchTallyEntry>();
  for (const l of launches) {
    if (!l.assetId || !l.tariffId) continue;
    const key = `${l.assetId}:${l.tariffId}`;
    const entry = byKey.get(key) ?? { assetId: l.assetId, tariffId: l.tariffId, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += Number(l.amount ?? 0);
    byKey.set(key, entry);
  }

  return Array.from(byKey.values()).map((e) => ({ ...e, amount: Math.round(e.amount * 100) / 100 }));
}

/** Начало окна агрегации для зоны — время последней сдачи итогов по ней, иначе null (с самого начала). */
export async function previousSubmissionBoundary(zoneId: string, tx: Tx | typeof prisma = prisma): Promise<Date | null> {
  const last = await tx.zoneSubmission.findFirst({
    where: { zoneId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}
