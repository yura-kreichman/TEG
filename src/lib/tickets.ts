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

export interface TicketOrderWindowItem {
  id: string;
  number: number;
  paymentMethod: string;
  totalSnapshot: number;
  expiresAt: Date | null;
  soldAt: Date;
  soldByOperatorName: string;
  tickets: {
    id: string;
    assetId: string;
    variantNameSnapshot: string;
    priceSnapshot: number;
    status: string;
    redeemedAt: Date | null;
  }[];
}

/**
 * Полные заказы (не только агрегат) зоны за то же окно, что и
 * aggregateTicketOrders выше — для аннулирования владельцем прямо в карточке
 * «Итоги дня» (docs/spec/10-tickets.md, "Кабинет владельца", п.3:
 * "аннулирование поштучно и «весь заказ»"; запрос пользователя 2026-07-21:
 * "где мы добавим возможность отмены заказа" → "прямо в карточке Итогов
 * дня" вместо отдельного экрана). В отличие от aggregate — включает и уже
 * аннулированные билеты/заказы (владелец видит полную картину окна, не
 * только то, что ещё считается в выручке).
 */
export async function listTicketOrdersForWindow(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<TicketOrderWindowItem[]> {
  const orders = await tx.ticketOrder.findMany({
    where: { zoneId, soldAt: { lte: until, ...(since ? { gt: since } : {}) } },
    orderBy: { soldAt: "desc" },
    include: { tickets: true, soldByOperator: { select: { name: true } } },
  });
  return orders.map((o) => ({
    id: o.id,
    number: o.number,
    paymentMethod: o.paymentMethod,
    totalSnapshot: Number(o.totalSnapshot),
    expiresAt: o.expiresAt,
    soldAt: o.soldAt,
    soldByOperatorName: o.soldByOperator.name,
    tickets: o.tickets.map((t) => ({
      id: t.id,
      assetId: t.assetId,
      variantNameSnapshot: t.variantNameSnapshot,
      priceSnapshot: Number(t.priceSnapshot),
      status: t.status,
      redeemedAt: t.redeemedAt,
    })),
  }));
}

/**
 * Тип MoneyOperation для возврата при аннулировании ПОСЛЕ сдачи итогов —
 * ПЕРЕИСПОЛЬЗУЕТ те же типы, что и сама выручка (revenue/revenue_cashless/
 * revenue_abonement), просто отрицательной суммой. Реальный баг (найден при
 * аудите отчётов 2026-07-21, запрос пользователя "не забудь перепроверить
 * все отчёты"): раньше здесь были отдельные ticket_refund/ticket_refund_
 * cashless/ticket_refund_abonement — корректно попадали в остаток физической
 * кассы зоны (zone-balance.ts, CASH_EXCLUDED_TYPES), НО ни один из отчётов
 * "Выручка"/"Прибыль" (money/route.ts, home-summary/route.ts, points/[id]/
 * reports/dynamics/route.ts) не знал про эти типы вовсе — они суммируют
 * строго "revenue"/"revenue_cashless"/"revenue_abonement" по имени, поэтому
 * возврат после сдачи молча не уменьшал показанную выручку. Тот же паттерн,
 * что у Товаров: voidGoodsSale (src/lib/goods.ts) переиспользует
 * moneyTypeFor(sale.paymentMethod) для своей компенсирующей записи, а не
 * отдельный "goods_refund" — это и есть источник комментария "тот же
 * трёхсторонний принцип" ниже, применённый теперь буквально, а не только к
 * CASH_EXCLUDED_TYPES. Zone-balance.ts не тронут — revenue_cashless/
 * revenue_abonement уже были в CASH_EXCLUDED_TYPES по своей исходной роли.
 */
export function ticketRefundMoneyType(paymentMethod: string): string {
  if (paymentMethod === "cash") return "revenue";
  if (paymentMethod === "mobile") return "revenue_cashless";
  return "revenue_abonement";
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
 *   компенсирующий MoneyOperation прямо сейчас (ticketRefundMoneyType, см.
 *   выше — тот же тип, что исходная выручка, отрицательной суммой).
 * - Возврат на кошелёк (AbonementTransaction type="refund") — ВСЕГДА при
 *   оплате балансом, независимо от того, была сдача или нет: баланс клиента
 *   независим от цикла сдач зоны — если списание было, возврат обязан
 *   произойти сразу, иначе деньги клиента просто пропадают без следа.
 * Принимает ЧУЖОЙ открытый tx — вызывающий роут ведёт транзакцию (одиночное
 * аннулирование или цикл по всем билетам заказа, см. API-роуты).
 *
 * actor — владелец ИЛИ оператор, ровно одно из userId/operatorId (тот же
 * приём, что MoneyOperation.performedByUserId/performedByOperatorId и
 * AbonementTransaction.userId/operatorId, теперь и у CorrectionLog).
 * Расширено с "только владелец" (запрос пользователя 2026-07-21): у
 * нал/безнал заказов уже пробит фискальный чек и возврат кассой рискует
 * скрыть недостачу, поэтому те остаются только у Владельца (роуты сами не
 * пускают сюда оператора для paymentMethod!="abonement") — а вот балансовый
 * возврат физической кассы вообще не касается, это чисто цифровая операция
 * на кошельке клиента, и Сотрудник с доступом к продаже билетов может
 * провести её сам.
 *
 * Возвращает false, а не бросает исключение, если билет уже не в статусе
 * "active" на момент записи (аудит 2026-07-25: раньше блок tx.ticket.update
 * ничем не был защищён от повторного срабатывания — вызывающие роуты читают
 * текущий status ДО открытия транзакции, и два почти одновременных запроса
 * на аннулирование одного билета оба проходили эту проверку и оба выполняли
 * возврат/декремент/зачисление на кошелёк дважды). CAS через updateMany —
 * тот же приём, что у Shift.close/AbonementWallet.spend.
 */
export async function voidTicketInTx(
  tx: Tx,
  ticket: VoidableTicket,
  order: VoidableOrder,
  actor: { tenantId: string; pointId: string; userId?: string; operatorId?: string }
): Promise<boolean> {
  const { tenantId, pointId, userId, operatorId } = actor;
  const amount = Number(ticket.priceSnapshot);

  const voidResult = await tx.ticket.updateMany({
    where: { id: ticket.id, status: "active" },
    data: { status: "voided", voidedAt: new Date() },
  });
  if (voidResult.count === 0) return false;
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
        performedByOperatorId: operatorId,
      },
    });
  }

  if (order.paymentMethod === "abonement" && order.walletId) {
    await tx.abonementWallet.update({ where: { id: order.walletId }, data: { balance: { increment: amount } } });
    await tx.abonementTransaction.create({
      data: { walletId: order.walletId, type: "refund", amount, ticketOrderId: order.id, pointId, userId, operatorId },
    });
  }

  return true;
}
