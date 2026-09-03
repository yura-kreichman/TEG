// Модуль "Билеты" (docs/spec/10-tickets.md) — Zone.accountingMode="tickets".
// Отдельно от game-room.ts, хотя логика похожа (advisory-lock номера,
// снапшоты цены) — принципиально другая модель: продажа заказом с
// несколькими позициями (билетами) сразу, а не одна запись на событие, и
// использование (гашение) разнесено во времени/операторах от продажи.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { smallestFreeNumber, previousSubmissionBoundary, LAUNCH_PAYMENT_METHODS } from "@/lib/game-room";
import { PAYMENT_SPLIT_METHOD } from "@/lib/payment-split";
import { localDateParts, zonedWallTimeToUtc } from "@/lib/business-day";

type Tx = Prisma.TransactionClient;

// Те же три способа оплаты, что у Пусков/Прибываний (docs/spec/10-tickets.md,
// "ЗАКАЗ") — переиспользуем список, не дублируем.
export const TICKET_PAYMENT_METHODS = LAUNCH_PAYMENT_METHODS;

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
  return order.expiresAt != null && order.expiresAt <= now;
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

/**
 * Срок жизни билета: конец дня «дата продажи + lifetimeDays» в поясе ТЕНАНТА.
 *
 * Раньше считалось через setDate/setHours — то есть в поясе процесса Node
 * (генеральная проверка финансов 2026-09-02, С16). У молдавского тенанта
 * сервер живёт в UTC, и билет сгорал в 23:59:59 UTC, то есть в 02:59 по
 * местному времени следующего дня — не в ту полночь, что напечатана на самом
 * билете. Спека (docs/spec/10-tickets.md:35) говорит «конец дня», и это
 * очевидно день тенанта: дата уходит клиенту на бумаге.
 *
 * Считаем через zonedWallTimeToUtc, а сдвиг дня — пересчётом Y/M/D, а не
 * прибавкой 24 часов: сутки не всегда 24 часа (переход на летнее время), и
 * этот же файл-помощник об этом предупреждает в шапке.
 */
export function computeTicketExpiresAt(soldAt: Date, lifetimeDays: number, timezone: string): Date {
  const { year, month, day } = localDateParts(soldAt, timezone);
  // Граница — НАЧАЛО СЛЕДУЮЩЕГО местного дня, а не 23:59 последнего (С61).
  // Секунд у zonedWallTimeToUtc нет вовсе, поэтому 23:59 отрезало последнюю
  // минуту напечатанного дня: билет с датой «16.08» с 23:59:00 до 23:59:59
  // уже получал «Срок истёк», хотя на бумаге у клиента ещё сегодня. Начало
  // следующего дня и сравнение через `expiresAt <= now` (isTicketExpired)
  // дают ровно календарный день, без потерянного хвоста.
  const shifted = new Date(Date.UTC(year, month - 1, day + lifetimeDays + 1));
  return zonedWallTimeToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), 0, 0, timezone);
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
      // Аннулирование НЕ переписывает уже закрытую сдачу (генеральная
      // проверка финансов 2026-09-02, С8). docs/spec/10-tickets.md:43 прямо
      // говорит: «если сдача уже прошла — аннулирование корректирующей роли в
      // прошлых сдачах не играет (они неизменны), возврат — текущее событие
      // кассы». Фильтр по статусу не смотрел на ВРЕМЯ отмены и задним числом
      // менял расчётную выручку закрытого дня. Поле Ticket.voidedAt писалось
      // с самого начала, но не читалось нигде.
      OR: [{ voidedAt: null }, { voidedAt: { gt: until } }],
      order: {
        zoneId,
        soldAt: { lte: until, ...(since ? { gt: since } : {}) },
      },
    },
    select: {
      priceSnapshot: true,
      status: true,
      orderId: true,
      order: { select: { paymentMethod: true, expiresAt: true, totalSnapshot: true } },
    },
  });

  const now = new Date();
  const orderIds = new Set<string>();
  const splitOrderIds = new Set<string>();
  // Сколько денег заказа попало в окно — для пропорции долей (С27).
  const countedByOrder = new Map<string, number>();
  const totalByOrder = new Map<string, number>();
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
    // Разбивка оплаты (запрос пользователя 2026-07-26) — считается ПО
    // ЗАКАЗУ, не по билету, ниже (частичное аннулирование разбитого заказа
    // запрещено сервером, поэтому пока у заказа есть хоть один незачёркнутый
    // билет в окне — это ВЕСЬ его исходный набор долей, без пропорций).
    else if (t.order.paymentMethod === PAYMENT_SPLIT_METHOD) {
      splitOrderIds.add(t.orderId);
      countedByOrder.set(t.orderId, (countedByOrder.get(t.orderId) ?? 0) + amount);
      totalByOrder.set(t.orderId, Number(t.order.totalSnapshot));
    }

    if (t.status === "redeemed") redeemedCount += 1;
    else if (isTicketExpired({ status: t.status }, t.order, now)) expiredCount += 1;
  }

  if (splitOrderIds.size > 0) {
    const legs = await tx.ticketOrderPaymentLeg.findMany({ where: { orderId: { in: [...splitOrderIds] } }, orderBy: { order: "asc" } });
    // Доли — ПРОПОРЦИОНАЛЬНО сумме билетов заказа, попавших в окно (С27). При
    // любом попавшем билете к окну прибавлялись доли ЗАКАЗА ЦЕЛИКОМ: если
    // часть билетов уже отменена, итог считался по уцелевшим, а разбивка — по
    // всем, и «нал + безнал + баланс» переставало сходиться с «Итого».
    // Остаток округления — на последнюю долю, как у долей корзины Товаров.
    const byOrder = new Map<string, { method: string; amount: number }[]>();
    for (const leg of legs) {
      const list = byOrder.get(leg.orderId) ?? [];
      list.push({ method: leg.method, amount: Number(leg.amount) });
      byOrder.set(leg.orderId, list);
    }
    for (const [orderId, list] of byOrder) {
      const counted = countedByOrder.get(orderId) ?? 0;
      const orderTotal = totalByOrder.get(orderId) ?? 0;
      const ratio = orderTotal > 0 ? counted / orderTotal : 0;
      let allocated = 0;
      list.forEach((leg, i) => {
        const share =
          i === list.length - 1
            ? Math.round((counted - allocated) * 100) / 100
            : Math.round(leg.amount * ratio * 100) / 100;
        allocated += share;
        if (leg.method === "cash") cashAmount += share;
        else if (leg.method === "mobile") mobileAmount += share;
        else if (leg.method === "abonement") abonementAmount += share;
      });
    }
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

export interface TicketAggregateWindow {
  id: string;
  zoneId: string;
  /** Конец окна — момент сдачи. */
  until: Date;
  /** Начало окна — предыдущая сдача этой зоны, null для первой. */
  since: Date | null;
}

/**
 * aggregateTicketOrders сразу для СПИСКА сдач — одним чтением билетов на все,
 * вместо чтения на каждую (аудит производительности 2026-08-14: Отчёты,
 * Главная и «Итоги по дням» вызывали его в цикле по сдачам, а сдач на живой
 * точке под сотню за месяц).
 *
 * Считает ровно то же, что функция выше, и намеренно повторяет её логику
 * построчно, а не оборачивает: разбивка сплит-оплаты идёт ПО ЗАКАЗУ, и
 * вытащить её в общий помощник, не сломав это правило, не выйдет.
 */
export async function aggregateTicketOrdersBySubmission(
  windows: TicketAggregateWindow[],
  tx: Tx | typeof prisma = prisma
): Promise<Map<string, TicketOrderAggregate>> {
  const result = new Map<string, TicketOrderAggregate>();
  if (windows.length === 0) return result;

  const until = new Date(Math.max(...windows.map((w) => w.until.getTime())));
  // Нижняя граница — по самому раннему началу окон: то, что отменили ещё до
  // него, не нужно ни одному окну. Нужна только чтобы ограничить выборку.
  const earliestSince = new Date(Math.min(...windows.map((w) => w.since?.getTime() ?? 0)));
  const tickets = await tx.ticket.findMany({
    where: {
      // Аннулирование НЕ переписывает уже закрытую сдачу (генеральная
      // проверка финансов 2026-09-02, С8). docs/spec/10-tickets.md:43 прямо
      // говорит: «если сдача уже прошла — аннулирование корректирующей роли в
      // прошлых сдачах не играет (они неизменны), возврат — текущее событие
      // кассы». Фильтр по статусу не смотрел на ВРЕМЯ отмены и задним числом
      // менял расчётную выручку закрытого дня. Поле Ticket.voidedAt писалось
      // с самого начала, но не читалось нигде.
      // Верхняя граница здесь — по САМОМУ ПОЗДНЕМУ окну, и только чтобы не
      // тянуть историю целиком. Сравнение с границей КОНКРЕТНОГО окна идёт
      // ниже, в цикле (генеральная проверка финансов, С26): билет, отменённый
      // после своей сдачи, но до самой поздней сдачи списка, этот общий фильтр
      // выбрасывал отовсюду — в том числе из своей уже закрытой сдачи, то есть
      // ровно тот сбой, который С8 и чинил.
      OR: [{ voidedAt: null }, { voidedAt: { gt: earliestSince } }],
      order: { zoneId: { in: [...new Set(windows.map((w) => w.zoneId))] }, soldAt: { lte: until } },
    },
    select: {
      priceSnapshot: true,
      status: true,
      orderId: true,
      voidedAt: true,
      order: { select: { paymentMethod: true, expiresAt: true, zoneId: true, soldAt: true, totalSnapshot: true } },
    },
  });

  const splitOrderIds = [
    ...new Set(tickets.filter((t) => t.order.paymentMethod === PAYMENT_SPLIT_METHOD).map((t) => t.orderId)),
  ];
  const legsByOrder = new Map<string, { method: string; amount: number }[]>();
  if (splitOrderIds.length > 0) {
    // orderBy — как у первой копии этого же агрегата выше (закрывающий
    // аудит 2026-09-03): остаток округления достаётся ПОСЛЕДНЕЙ доле, и без
    // явного порядка две копии отдавали копейку разным способам оплаты —
    // «нал» в сводке расходился с «налом» в отчёте на 0,01.
    const legs = await tx.ticketOrderPaymentLeg.findMany({
      where: { orderId: { in: splitOrderIds } },
      orderBy: { order: "asc" },
    });
    for (const leg of legs) {
      const list = legsByOrder.get(leg.orderId) ?? [];
      list.push({ method: leg.method, amount: Number(leg.amount) });
      legsByOrder.set(leg.orderId, list);
    }
  }

  const byZone = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const list = byZone.get(t.order.zoneId) ?? [];
    list.push(t);
    byZone.set(t.order.zoneId, list);
  }

  const now = new Date();
  for (const w of windows) {
    // Отмена сравнивается с границей ЭТОГО окна (С26): билет, отменённый уже
    // после своей сдачи, для неё остаётся проданным — «сдача неизменна,
    // возврат это текущее событие кассы» (docs/spec/10-tickets.md:43).
    const inWindow = (byZone.get(w.zoneId) ?? []).filter(
      (t) =>
        t.order.soldAt <= w.until &&
        (!w.since || t.order.soldAt > w.since) &&
        (t.voidedAt == null || t.voidedAt > w.until)
    );
    const orderIds = new Set<string>();
    const splitInWindow = new Set<string>();
    // Сколько денег заказа реально попало в окно — для пропорции долей (С27).
    const countedByOrder = new Map<string, number>();
    let totalAmount = 0;
    let cashAmount = 0;
    let mobileAmount = 0;
    let abonementAmount = 0;
    let redeemedCount = 0;
    let expiredCount = 0;

    for (const t of inWindow) {
      orderIds.add(t.orderId);
      const amount = Number(t.priceSnapshot);
      totalAmount += amount;
      if (t.order.paymentMethod === "cash") cashAmount += amount;
      else if (t.order.paymentMethod === "mobile") mobileAmount += amount;
      else if (t.order.paymentMethod === "abonement") abonementAmount += amount;
      else if (t.order.paymentMethod === PAYMENT_SPLIT_METHOD) {
        splitInWindow.add(t.orderId);
        countedByOrder.set(t.orderId, (countedByOrder.get(t.orderId) ?? 0) + amount);
      }

      if (t.status === "redeemed") redeemedCount += 1;
      else if (isTicketExpired({ status: t.status }, t.order, now)) expiredCount += 1;
    }

    // Доли разбитой оплаты — ПРОПОРЦИОНАЛЬНО тому, сколько билетов заказа
    // реально попало в окно (С27). Раньше при любом попавшем билете к окну
    // прибавлялись доли ЗАКАЗА ЦЕЛИКОМ: если часть билетов отменена, итог
    // считался по уцелевшим, а разбивка — по всем, и «нал + безнал + баланс»
    // переставало сходиться с «Итого». Остаток округления — на последнюю
    // долю, тем же приёмом, что у долей корзины Товаров.
    const totalByOrder = new Map<string, number>();
    for (const t of inWindow) totalByOrder.set(t.orderId, Number(t.order.totalSnapshot));
    for (const orderId of splitInWindow) {
      const legs = legsByOrder.get(orderId) ?? [];
      const counted = countedByOrder.get(orderId) ?? 0;
      const orderTotal = totalByOrder.get(orderId) ?? 0;
      const ratio = orderTotal > 0 ? counted / orderTotal : 0;
      let allocated = 0;
      legs.forEach((leg, i) => {
        const share =
          i === legs.length - 1
            ? Math.round((counted - allocated) * 100) / 100
            : Math.round(leg.amount * ratio * 100) / 100;
        allocated += share;
        if (leg.method === "cash") cashAmount += share;
        else if (leg.method === "mobile") mobileAmount += share;
        else if (leg.method === "abonement") abonementAmount += share;
      });
    }

    result.set(w.id, {
      ordersCount: orderIds.size,
      ticketsCount: inWindow.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      cashAmount: Math.round(cashAmount * 100) / 100,
      mobileAmount: Math.round(mobileAmount * 100) / 100,
      abonementAmount: Math.round(abonementAmount * 100) / 100,
      redeemedCount,
      expiredCount,
    });
  }

  return result;
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
      // Аннулирование НЕ переписывает уже закрытую сдачу (генеральная
      // проверка финансов 2026-09-02, С8). docs/spec/10-tickets.md:43 прямо
      // говорит: «если сдача уже прошла — аннулирование корректирующей роли в
      // прошлых сдачах не играет (они неизменны), возврат — текущее событие
      // кассы». Фильтр по статусу не смотрел на ВРЕМЯ отмены и задним числом
      // менял расчётную выручку закрытого дня. Поле Ticket.voidedAt писалось
      // с самого начала, но не читалось нигде.
      OR: [{ voidedAt: null }, { voidedAt: { gt: until } }],
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
  // Цветовая метка продавца — чтобы «Итоги дня» рисовали его тем же чипом
  // PerformedByTag, что и продажи товаров/абонементов в соседних карточках.
  // Владельца тут не бывает: soldByOperatorId в схеме обязателен, заказы
  // оформляет только Сотрудник.
  soldByOperatorColorTag: string | null;
  tickets: {
    id: string;
    assetId: string;
    variantNameSnapshot: string;
    priceSnapshot: number;
    status: string;
    redeemedAt: Date | null;
    // Кто погасил. Гашение — отдельное событие, разнесённое с продажей по
    // времени и по сотруднику (docs/spec/10-tickets.md), поэтому продавца
    // заказа тут переиспользовать нельзя: это в общем случае разные люди.
    redeemedByOperatorName: string | null;
    redeemedByOperatorColorTag: string | null;
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
    include: {
      tickets: { include: { redeemedByOperator: { select: { name: true, colorTag: true } } } },
      soldByOperator: { select: { name: true, colorTag: true } },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    number: o.number,
    paymentMethod: o.paymentMethod,
    totalSnapshot: Number(o.totalSnapshot),
    expiresAt: o.expiresAt,
    soldAt: o.soldAt,
    soldByOperatorName: o.soldByOperator.name,
    soldByOperatorColorTag: o.soldByOperator.colorTag,
    tickets: o.tickets.map((t) => ({
      id: t.id,
      assetId: t.assetId,
      variantNameSnapshot: t.variantNameSnapshot,
      priceSnapshot: Number(t.priceSnapshot),
      status: t.status,
      redeemedAt: t.redeemedAt,
      redeemedByOperatorName: t.redeemedByOperator?.name ?? null,
      redeemedByOperatorColorTag: t.redeemedByOperator?.colorTag ?? null,
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

  // Разбивка оплаты (запрос пользователя 2026-07-26) — возврат ДЕНЕГ разбитого
  // заказа считается ОДИН РАЗ на весь заказ, не по билету (см.
  // refundOrderSplitLegsTx ниже) — здесь для split-заказа только сам билет
  // помечается voided, вызывающий роут отдельно вызывает refundOrderSplitLegsTx
  // после цикла по всем билетам заказа. Одиночное аннулирование ОДНОГО билета
  // разбитого заказа сервер вообще не допускает раньше этой функции (см.
  // /api/tickets/[id]/void) — сюда для split приходит только полный цикл по
  // заказу.
  if (order.paymentMethod !== PAYMENT_SPLIT_METHOD) {
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
  }

  return true;
}

/**
 * Возврат денег разбитого заказа целиком (запрос пользователя 2026-07-26) —
 * вызывается ОДИН раз после того, как все аннулируемые билеты заказа уже
 * помечены voided (voidTicketInTx выше сам ничего не возвращает для
 * paymentMethod="split"). refundAmount — сумма priceSnapshot реально
 * аннулированных сейчас билетов; распределяется по долям заказа
 * пропорционально (частичное аннулирование одного билета из разбитого
 * заказа запрещено сервером — на практике refundAmount всегда равен либо
 * 0, либо полной сумме заказа, но пропорция считается честно на случай
 * будущих изменений этого правила).
 */
export async function refundOrderSplitLegsTx(
  tx: Tx,
  order: { id: string; zoneId: string; soldAt: Date; totalSnapshot: Prisma.Decimal | number },
  refundAmount: number,
  actor: { tenantId: string; pointId: string; userId?: string; operatorId?: string }
): Promise<{ walletId: string; amount: number }[]> {
  const refundedWalletLegs: { walletId: string; amount: number }[] = [];
  if (refundAmount <= 0) return refundedWalletLegs;
  const { tenantId, pointId, userId, operatorId } = actor;

  const legs = await tx.ticketOrderPaymentLeg.findMany({ where: { orderId: order.id }, orderBy: { order: "asc" } });
  if (legs.length === 0) return refundedWalletLegs;

  const total = Number(order.totalSnapshot);
  const boundary = await previousSubmissionBoundary(order.zoneId, tx);
  const isPostSubmission = boundary != null && order.soldAt <= boundary;

  let allocated = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const legAmount = Number(leg.amount);
    const isLast = i === legs.length - 1;
    const share = isLast
      ? Math.round((refundAmount - allocated) * 100) / 100
      : Math.round(((legAmount * refundAmount) / total) * 100) / 100;
    allocated += share;
    if (share <= 0) continue;

    if (isPostSubmission) {
      await tx.moneyOperation.create({
        data: {
          tenantId,
          zoneId: order.zoneId,
          type: ticketRefundMoneyType(leg.method),
          amount: -share,
          performedByUserId: userId,
          performedByOperatorId: operatorId,
        },
      });
    }

    if (leg.method === "abonement" && leg.walletId) {
      await tx.abonementWallet.update({ where: { id: leg.walletId }, data: { balance: { increment: share } } });
      await tx.abonementTransaction.create({
        data: { walletId: leg.walletId, type: "refund", amount: share, ticketOrderId: order.id, pointId, userId, operatorId },
      });
      refundedWalletLegs.push({ walletId: leg.walletId, amount: share });
    }
  }
  return refundedWalletLegs;
}
