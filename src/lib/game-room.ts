// Модуль "Игровая комната" (docs/spec/04-game-room.md) — чистая расчётная
// логика и общие для бэкенд-роутов операции с пусками. Отдельно от
// results-calc.ts (тот — про counters/launches/cash_only), потому что расчёт
// здесь принципиально другой: не от показаний/введённого итога, а от
// агрегата реальных старт/стоп записей.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

export const LAUNCH_PRICING_MODES = ["fixed", "per_minute"] as const;
export type LaunchPricingMode = (typeof LAUNCH_PRICING_MODES)[number];

export const LAUNCH_ROUNDING_MODES = ["up", "down", "nearest"] as const;
export type LaunchRoundingMode = (typeof LAUNCH_ROUNDING_MODES)[number];

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
 * Действующий тариф зоны на момент времени `at` — запись LaunchPricing с
 * максимальным effectiveFrom <= at (тот же паттерн, что действующая ставка
 * оператора в 05-work-time.md). null, если владелец ещё не задал тариф.
 */
export async function getLaunchPricingAt(zoneId: string, at: Date, tx: Tx | typeof prisma = prisma) {
  return tx.launchPricing.findFirst({
    where: { zoneId, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
  });
}

/**
 * Следующий номер пуска в рамках (zoneId, assetId) — атомарно через
 * advisory-lock транзакции (не через @@unique — assetId nullable, а Postgres
 * не считает NULL=NULL для уникальности, так что unique-констрейнт не
 * защитил бы зону без активов). Лок держится до конца транзакции tx и сам
 * снимается коммитом/роллбэком — вызывающий код обязан вызывать это внутри
 * prisma.$transaction.
 */
export async function nextLaunchNumber(tx: Tx, zoneId: string, assetId: string | null): Promise<number> {
  const lockKey = `${zoneId}:${assetId ?? "zone"}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const last = await tx.launch.findFirst({
    where: { zoneId, assetId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

export async function countOpenLaunches(zoneId: string, assetId: string | null, tx: Tx | typeof prisma = prisma) {
  return tx.launch.count({ where: { zoneId, assetId, isOpen: true } });
}

/**
 * Зона доступна оператору для операций с пусками — та же проверка, что уже
 * используется для мастера сдачи итогов (submission-context/route.ts):
 * своя точка + (доступ ко всем зонам ИЛИ зона в allowedZones).
 */
export async function findOperatorGameRoomZone(
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
      launchMode: "game_room",
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    include: { assets: true },
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

  const rawMinutes = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60000);
  const mode = pricing.roundingModeSnapshot ?? "nearest";
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
    select: { id: true, amount: true, startedAt: true, endedAt: true },
  });

  let totalAmount = 0;
  let totalMinutes = 0;
  for (const l of launches) {
    totalAmount += Number(l.amount ?? 0);
    if (l.endedAt) totalMinutes += (l.endedAt.getTime() - l.startedAt.getTime()) / 60000;
  }

  return {
    count: launches.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalMinutes: Math.round(totalMinutes),
    launchIds: launches.map((l) => l.id),
  };
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
