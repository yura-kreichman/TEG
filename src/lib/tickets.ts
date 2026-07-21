// Модуль "Билеты" (docs/spec/10-tickets.md) — Zone.accountingMode="tickets".
// Отдельно от game-room.ts, хотя логика похожа (advisory-lock номера,
// снапшоты цены) — принципиально другая модель: продажа заказом с
// несколькими позициями (билетами) сразу, а не одна запись на событие, и
// использование (гашение) разнесено во времени/операторах от продажи.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  smallestFreeNumber,
  previousSubmissionBoundary,
  LAUNCH_PAYMENT_METHODS,
  type LaunchPaymentMethod,
} from "@/lib/game-room";

type Tx = Prisma.TransactionClient;

// Те же три способа оплаты, что у Пусков/Прибываний (docs/spec/10-tickets.md,
// "ЗАКАЗ") — переиспользуем список, не дублируем.
export const TICKET_PAYMENT_METHODS = LAUNCH_PAYMENT_METHODS;
export type TicketPaymentMethod = LaunchPaymentMethod;

/**
 * Номер заказа для следующей продажи — наименьший свободный СРЕДИ ЗАНЯТЫХ
 * заказов этой ЗОНЫ (не актива, как у Launch.number — docs/spec/10-tickets.md,
 * "НОМЕР ЗАКАЗА": "пул отдельный на зону"). "Занят" = openTicketsCount > 0 И
 * (expiresAt IS NULL ИЛИ expiresAt > now) — см. комментарий у
 * TicketOrder.openTicketsCount в schema.prisma. Атомарно через advisory-lock
 * транзакции, тот же паттерн, что nextLaunchNumber (src/lib/game-room.ts),
 * просто лок по zoneId, не assetId.
 */
export async function nextTicketOrderNumber(tx: Tx, zoneId: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${zoneId}))`;
  const now = new Date();
  const occupied = await tx.ticketOrder.findMany({
    where: {
      zoneId,
      openTicketsCount: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { number: true },
  });
  return smallestFreeNumber(occupied.map((o) => o.number));
}

/**
 * Зона доступна оператору для продажи/гашения билетов — та же проверка
 * доступа, что findOperatorStaysZone/findOperatorLaunchesZone
 * (src/lib/game-room.ts): своя точка + (доступ ко всем зонам ИЛИ зона в
 * allowedZones). Варианты цен активов подгружаются сразу — нужны на экране
 * "Продать" сразу после выбора актива.
 */
export async function findOperatorTicketsZone(
  zoneId: string,
  pointId: string,
  operator: { id: string; allZonesAccess: boolean }
) {
  return prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId,
      active: true,
      accountingMode: "tickets",
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    include: {
      assets: {
        include: { ticketVariants: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
      },
    },
  });
}

/** "Истёк ли" заказ (и с ним все его билеты) — вычисляется на лету, никогда
 * не хранится (docs/spec/10-tickets.md, "СРОК ЖИЗНИ": "статус expired
 * назначается лениво при чтении, отдельного крона нет"). Срок общий на весь
 * заказ, не по билетам — один билет одного заказа не может быть "истёк",
 * пока другой в том же заказе ещё "жив".
 */
export function isTicketOrderExpired(order: { expiresAt: Date | null }, now: Date = new Date()): boolean {
  return order.expiresAt != null && order.expiresAt < now;
}

/** "Истёк ли" конкретный билет — активный билет заказа, чей срок истёк. Билеты
 * в статусе redeemed/voided не могут "истечь" (уже терминальны). */
export function isTicketExpired(
  ticket: { status: string },
  order: { expiresAt: Date | null },
  now: Date = new Date()
): boolean {
  return ticket.status === "active" && isTicketOrderExpired(order, now);
}

/** Конец дня (23:59:59.999) для снапшота expiresAt при продаже — "дата
 * продажи + дни; конец дня" (docs/spec/10-tickets.md, "СРОК ЖИЗНИ"). */
export function computeTicketExpiresAt(soldAt: Date, lifetimeDays: number): Date {
  const d = new Date(soldAt);
  d.setDate(d.getDate() + lifetimeDays);
  d.setHours(23, 59, 59, 999);
  return d;
}

export interface TicketOrderAggregate {
  ordersCount: number;
  ticketsCount: number;
  totalAmount: number;
  cashAmount: number;
  mobileAmount: number;
  abonementAmount: number;
  redeemedCount: number;
  expiredCount: number;
}

/**
 * Агрегат проданных (не аннулированных) билетов зоны за окно — используется
 * и для расчётной выручки в мастере сдачи итогов, и для карточки владельца/
 * сводки (docs/spec/10-tickets.md, "ДЕНЬГИ И СДАЧА ИТОГОВ", "ОТЧЁТЫ").
 * Окно — по ЗАКАЗУ (order.soldAt), не по билету: билеты одного заказа
 * продаются одномоментно. `since` исключается (>), `until` включается (<=) —
 * тот же принцип, что aggregateGameRoomLaunches (src/lib/game-room.ts).
 * Способ оплаты — с заказа (billет своего paymentMethod не хранит, оплата
 * целиком одна на заказ).
 */
export async function aggregateTicketOrders(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<TicketOrderAggregate> {
  const tickets = await tx.ticket.findMany({
    where: {
      status: { not: "voided" },
      order: {
        zoneId,
        soldAt: { lte: until, ...(since ? { gt: since } : {}) },
      },
    },
    select: {
      priceSnapshot: true,
      status: true,
      orderId: true,
      order: { select: { paymentMethod: true, expiresAt: true } },
    },
  });

  const now = new Date();
  const orderIds = new Set<string>();
  let totalAmount = 0;
  let cashAmount = 0;
  let mobileAmount = 0;
  let abonementAmount = 0;
  let redeemedCount = 0;
  let expiredCount = 0;

  for (const t of tickets) {
    orderIds.add(t.orderId);
    const amount = Number(t.priceSnapshot);
    totalAmount += amount;
    if (t.order.paymentMethod === "cash") cashAmount += amount;
    else if (t.order.paymentMethod === "mobile") mobileAmount += amount;
    else if (t.order.paymentMethod === "abonement") abonementAmount += amount;

    if (t.status === "redeemed") redeemedCount += 1;
    else if (isTicketExpired({ status: t.status }, t.order, now)) expiredCount += 1;
  }

  return {
    ordersCount: orderIds.size,
    ticketsCount: tickets.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    cashAmount: Math.round(cashAmount * 100) / 100,
    mobileAmount: Math.round(mobileAmount * 100) / 100,
    abonementAmount: Math.round(abonementAmount * 100) / 100,
    redeemedCount,
    expiredCount,
  };
}

export interface TicketAssetVariantBreakdown {
  assetId: string;
  variantName: string;
  count: number;
  amount: number;
}

/** Разрез выручки по активу+варианту — для раскрытия карточки сдачи в
 * "Показаниях по дням" (docs/spec/10-tickets.md, "ОТЧЁТЫ", п.2). */
export async function ticketRevenueByAssetVariant(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<TicketAssetVariantBreakdown[]> {
  const tickets = await tx.ticket.findMany({
    where: {
      status: { not: "voided" },
      order: { zoneId, soldAt: { lte: until, ...(since ? { gt: since } : {}) } },
    },
    select: { assetId: true, variantNameSnapshot: true, priceSnapshot: true },
  });

  const byKey = new Map<string, TicketAssetVariantBreakdown>();
  for (const t of tickets) {
    const key = `${t.assetId}:${t.variantNameSnapshot}`;
    const entry = byKey.get(key) ?? { assetId: t.assetId, variantName: t.variantNameSnapshot, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += Number(t.priceSnapshot);
    byKey.set(key, entry);
  }
  return Array.from(byKey.values()).map((e) => ({ ...e, amount: Math.round(e.amount * 100) / 100 }));
}

/** Тип MoneyOperation для возврата при аннулировании ПОСЛЕ сдачи итогов —
 * тот же трёхсторонний принцип, что moneyTypeFor у Товаров
 * (src/lib/goods.ts): нал — физическая, не исключённая из кассы; безнал и
 * баланс — учётные, в CASH_EXCLUDED_TYPES (src/lib/zone-balance.ts). */
export function ticketRefundMoneyType(paymentMethod: string): string {
  if (paymentMethod === "cash") return "ticket_refund";
  if (paymentMethod === "mobile") return "ticket_refund_cashless";
  return "ticket_refund_abonement";
}

export interface VoidableTicket {
  id: string;
  orderId: string;
  priceSnapshot: Prisma.Decimal | number;
}

export interface VoidableOrder {
  id: string;
  zoneId: string;
  paymentMethod: string;
  walletId: string | null;
  soldAt: Date;
}

/**
 * Аннулирование ОДНОГО билета (владелец) — docs/spec/10-tickets.md,
 * "АННУЛИРОВАНИЕ": возврат по priceSnapshot билета, освобождение номера
 * заказа через декремент openTicketsCount (см. его комментарий в
 * schema.prisma). Деньги — по обсуждённой на ШАГЕ 2 схеме:
 * - ДО сдачи итогов, в которую попал бы этот билет: MoneyOperation не
 *   нужна вовсе — билет просто перестаёт учитываться в расчётной выручке
 *   следующего окна (aggregateTicketOrders выше фильтрует status!="voided"),
 *   тот же принцип, что аннулирование Launch до сдачи (докс: "исключаются
 *   из расчётной выручки того окна... если сдача ещё не сделана").
 * - ПОСЛЕ сдачи итогов — прошлая сдача неизменна, поэтому нужен ЯВНЫЙ
 *   компенсирующий MoneyOperation прямо сейчас (ticket_refund*, см. выше).
 * - Возврат на кошелёк (AbonementTransaction type="refund") — ВСЕГДА при
 *   оплате балансом, независимо от того, была сдача или нет: баланс клиента
 *   независим от цикла сдач зоны — если списание было, возврат обязан
 *   произойти сразу, иначе деньги клиента просто пропадают без следа.
 * Принимает ЧУЖОЙ открытый tx — вызывающий роут ведёт транзакцию (одиночное
 * аннулирование или цикл по всем билетам заказа, см. API-роуты).
 */
export async function voidTicketInTx(
  tx: Tx,
  ticket: VoidableTicket,
  order: VoidableOrder,
  actor: { tenantId: string; pointId: string; userId: string }
): Promise<void> {
  const { tenantId, pointId, userId } = actor;
  const amount = Number(ticket.priceSnapshot);

  await tx.ticket.update({ where: { id: ticket.id }, data: { status: "voided", voidedAt: new Date() } });
  await tx.ticketOrder.update({ where: { id: order.id }, data: { openTicketsCount: { decrement: 1 } } });

  const boundary = await previousSubmissionBoundary(order.zoneId, tx);
  const isPostSubmission = boundary != null && order.soldAt <= boundary;

  if (isPostSubmission) {
    await tx.moneyOperation.create({
      data: {
        tenantId,
        zoneId: order.zoneId,
        type: ticketRefundMoneyType(order.paymentMethod),
        amount: -amount,
        performedByUserId: userId,
      },
    });
  }

  if (order.paymentMethod === "abonement" && order.walletId) {
    await tx.abonementWallet.update({ where: { id: order.walletId }, data: { balance: { increment: amount } } });
    await tx.abonementTransaction.create({
      data: { walletId: order.walletId, type: "refund", amount, ticketOrderId: order.id, pointId, userId },
    });
  }
}
