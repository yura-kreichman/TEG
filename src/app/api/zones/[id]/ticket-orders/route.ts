import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { requireOwner, findTenantZone } from "@/lib/require-owner";
import {
  TICKET_PAYMENT_METHODS,
  aggregateTicketOrders,
  computeTicketExpiresAt,
  findOperatorTicketsZone,
  nextTicketOrderNumber,
} from "@/lib/tickets";
import { previousSubmissionBoundary } from "@/lib/game-room";
import { InsufficientBalanceError, spendWalletForTicketOrderTx, notifyWalletBalanceChange } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { PAYMENT_SPLIT_METHOD, validateSplitLegs, InvalidPaymentSplitError, type PaymentLegInput } from "@/lib/payment-split";

interface CartItemInput {
  assetId?: unknown;
  variantId?: unknown;
  quantity?: unknown;
}

function serializeOrder(o: {
  id: string;
  number: number;
  paymentMethod: string;
  totalSnapshot: unknown;
  expiresAt: Date | null;
  openTicketsCount: number;
  soldAt: Date;
  soldByOperator: { name: string };
  tickets: {
    id: string;
    assetId: string;
    variantNameSnapshot: string;
    priceSnapshot: unknown;
    status: string;
    redeemedAt: Date | null;
  }[];
  paymentLegs: { method: string; amount: unknown; order: number }[];
}) {
  return {
    id: o.id,
    number: o.number,
    paymentMethod: o.paymentMethod,
    totalSnapshot: Number(o.totalSnapshot),
    expiresAt: o.expiresAt,
    openTicketsCount: o.openTicketsCount,
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
    // Разбивка оплаты (аудит 2026-07-26) — раньше терялась при повторном
    // чтении заказа (поиск по номеру/лента "Заказы"): писалась в БД при
    // продаже, но не выбиралась и не возвращалась здесь, из-за чего
    // допечатка/список показывали буквально "split" вместо разбивки.
    legs: o.paymentLegs.length
      ? o.paymentLegs.sort((a, b) => a.order - b.order).map((l) => ({ method: l.method, amount: Number(l.amount) }))
      : undefined,
  };
}

/**
 * Без ?number= — лента последних заказов зоны (docs/spec/10-tickets.md,
 * "PWA оператора", вкладка «Заказы»: "Лента последних заказов зоны — ниже
 * поля ввода, вторична"). С ?number= — поиск ПО НОМЕРУ (циферблат) — берётся
 * САМЫЙ ПОЗДНИЙ заказ зоны с этим номером: пока гашение включено и номер
 * переиспользуется, ровно один заказ с данным номером может быть "живым"
 * (openTicketsCount > 0) одновременно — он неизбежно самый свежий среди всех
 * заказов, когда-либо друживших этот номер; при выключенном гашении номера
 * не переиспользуются вовсе, там "самый свежий" и "единственный" совпадают
 * всегда (докс: "заказ по номеру: живой заказ по номеру зоны; исторические —
 * по id" — по id это работает уже сейчас неявно, GET одного заказа по его
 * TicketOrder.id не нужен отдельным роутом, клиент просто помнит id из
 * предыдущего ответа). Оба режима доступны ЛЮБОМУ оператору с доступом к
 * зоне, не только с тумблером "Продажа билетов" (тот гейтит только продажу,
 * не просмотр/гашение — см. POST ниже и /api/tickets/[id]/redeem).
 *
 * Владелец тоже может искать по номеру этим же роутом (авторизация —
 * owner-сессия вместо operator-сессии, без привязки к точке/allZonesAccess).
 * "Список за период" с `from`/`to` для владельца (изначальный план отдельного
 * экрана "Заказы") здесь БОЛЬШЕ НЕ ИСПОЛЬЗУЕТСЯ — тот экран удалён (запрос
 * пользователя 2026-07-21: "у Владельца не нужны эти заказы"), аннулирование
 * теперь живёт прямо в карточке «Итоги дня» на своих данных (money/readings,
 * /api/reports/counters/day), не через этот роут.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/zones/[id]/ticket-orders">) {
  const { id: zoneId } = await ctx.params;

  const opCtx = await requireOperator();
  let zone: { id: string; accountingMode: string } | null = null;
  if (opCtx) {
    zone = await findOperatorTicketsZone(zoneId, opCtx.point.id, opCtx.operator);
  } else {
    const owner = await requireOwner();
    if (!owner) {
      return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
    }
    const ownerZone = await findTenantZone(owner.tenantId, zoneId);
    zone = ownerZone && ownerZone.accountingMode === "tickets" ? ownerZone : null;
  }
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const url = new URL(request.url);
  const numberParam = url.searchParams.get("number");

  // ?aggregate=1 — расчётная выручка зоны с момента предыдущей сдачи, для
  // мастера сдачи итогов (docs/spec/10-tickets.md, "ДЕНЬГИ И СДАЧА ИТОГОВ":
  // "касса одной парой полей... расчётная выручка read-only"). Тот же
  // источник (aggregateTicketOrders), что submit-results/route.ts использует
  // при реальной сдаче — превью гарантированно совпадёт с тем, что
  // фактически посчитается при отправке. В отличие от поиска по номеру/ленты
  // заказов ниже (доступны любому оператору с доступом к зоне) — это уже не
  // "посмотреть/погасить билет", а касса/выручка зоны, поэтому тот же гейт
  // ticketsAccess, что и у самой Сдачи итогов (аудит 2026-07-26: раньше
  // серверной проверки не было вовсе — оператор без тумблера "Продажа
  // билетов", зная zoneId, мог прочитать агрегат кассы зоны напрямую).
  if (url.searchParams.get("aggregate") === "1") {
    if (opCtx && !opCtx.operator.ticketsAccess) {
      return NextResponse.json({ error: "Нет доступа к продаже билетов" }, { status: 403 });
    }
    const boundary = await previousSubmissionBoundary(zoneId);
    const agg = await aggregateTicketOrders(zoneId, boundary, new Date());
    return NextResponse.json({ aggregate: agg });
  }

  if (numberParam !== null) {
    const number = Number(numberParam);
    if (!Number.isFinite(number) || number < 1) {
      return NextResponse.json({ error: "Некорректный номер" }, { status: 400 });
    }
    const order = await prisma.ticketOrder.findFirst({
      where: { zoneId, number },
      orderBy: { soldAt: "desc" },
      include: { tickets: true, soldByOperator: { select: { name: true } }, paymentLegs: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    return NextResponse.json({ order: serializeOrder(order) });
  }

  // Лента последних заказов — только "живые" (openTicketsCount > 0, запрос
  // пользователя 2026-07-21: "сотрудник, который видит только Заказы, должен
  // видеть только активные — аннулированные/погашенные ему не нужны").
  // Полностью погашенный/аннулированный заказ ничего не даёт оператору
  // (гасить/аннулировать больше нечего) — только шумит в списке. Истёкший,
  // но ещё не погашенный целиком заказ ОСТАЁТСЯ (openTicketsCount не
  // декрементируется истечением) — его ещё можно аннулировать балансом.
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);
  const orders = await prisma.ticketOrder.findMany({
    where: { zoneId, openTicketsCount: { gt: 0 } },
    orderBy: { soldAt: "desc" },
    take: limit,
    include: { tickets: true, soldByOperator: { select: { name: true } }, paymentLegs: true },
  });

  return NextResponse.json({ orders: orders.map(serializeOrder) });
}

/**
 * Продажа заказа — атомарно, "создан+оплачен" одной транзакцией
 * (docs/spec/10-tickets.md, "ЗАКАЗ") — серверных черновиков нет, корзина
 * приходит целиком в одном запросе. Только с тумблером оператора
 * "Продажа билетов" — серверная проверка, не только скрытие вкладки в UI
 * (тот же принцип, что goodsAccess, docs/spec/09-goods.md).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/ticket-orders">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  if (!operator.ticketsAccess) {
    return NextResponse.json({ error: "Нет доступа к продаже билетов" }, { status: 403 });
  }
  const { id: zoneId } = await ctx.params;

  const zone = await findOperatorTicketsZone(zoneId, point.id, operator);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? (body.items as CartItemInput[]) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Корзина пуста" }, { status: 400 });
  }
  // Разбивка оплаты (запрос пользователя 2026-07-26) — необязательный массив
  // долей вместо одного paymentMethod; сумма долей проверяется ниже, когда
  // становится известна totalSnapshot корзины.
  const legs: PaymentLegInput[] | undefined = Array.isArray(body.legs)
    ? (body.legs as unknown[]).map((raw) => {
        const l = raw as { method?: unknown; amount?: unknown; walletId?: unknown };
        return {
          method: typeof l?.method === "string" ? l.method : "",
          amount: Number(l?.amount),
          walletId: typeof l?.walletId === "string" ? l.walletId : undefined,
        };
      })
    : undefined;

  if (!legs && !(TICKET_PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
    return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
  }
  const paymentMethod: (typeof TICKET_PAYMENT_METHODS)[number] = legs ? "cash" : body.paymentMethod;
  const abonementWalletId: string | null =
    typeof body.abonementWalletId === "string" && body.abonementWalletId ? body.abonementWalletId : null;
  const usesBalance = legs ? legs.some((l) => l.method === "abonement") : paymentMethod === "abonement";
  if (usesBalance) {
    if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
      return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
    }
    if (!legs && !abonementWalletId) {
      return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
    }
  }

  // Валидация корзины + разворот "количество" в отдельные билеты — все
  // варианты должны принадлежать активам ЭТОЙ зоны и не быть удалены
  // (докс: "Актив без единого варианта не может попасть в заказ").
  const assetsById = new Map(zone.assets.map((a) => [a.id, a]));
  const ticketsToCreate: { assetId: string; variantNameSnapshot: string; priceSnapshot: number }[] = [];
  for (const item of items) {
    const assetId = typeof item.assetId === "string" ? item.assetId : "";
    const variantId = typeof item.variantId === "string" ? item.variantId : "";
    const quantity = Number(item.quantity);
    const asset = assetsById.get(assetId);
    if (!asset) {
      return NextResponse.json({ error: "Актив не найден" }, { status: 400 });
    }
    const variant = asset.ticketVariants.find((v) => v.id === variantId);
    if (!variant) {
      return NextResponse.json({ error: "Вариант цены не найден" }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
      return NextResponse.json({ error: "Некорректное количество" }, { status: 400 });
    }
    for (let i = 0; i < quantity; i++) {
      ticketsToCreate.push({ assetId, variantNameSnapshot: variant.name, priceSnapshot: Number(variant.price) });
    }
  }

  const totalSnapshot = Math.round(ticketsToCreate.reduce((sum, t) => sum + t.priceSnapshot, 0) * 100) / 100;
  if (legs) {
    try {
      validateSplitLegs(legs, totalSnapshot, TICKET_PAYMENT_METHODS);
    } catch (err) {
      if (err instanceof InvalidPaymentSplitError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }
  const now = new Date();
  // Срок жизни — только при включённом гашении (докс, "СРОК ЖИЗНИ"); при
  // выключенном гашении или ticketLifetimeDays=null — бессрочно.
  const expiresAt =
    zone.ticketRedemptionEnabled && zone.ticketLifetimeDays != null
      ? computeTicketExpiresAt(now, zone.ticketLifetimeDays)
      : null;

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const number = await nextTicketOrderNumber(tx, zone.id);
      const created = await tx.ticketOrder.create({
        data: {
          zoneId: zone.id,
          number,
          paymentMethod: legs ? PAYMENT_SPLIT_METHOD : paymentMethod,
          walletId: !legs && paymentMethod === "abonement" ? abonementWalletId : null,
          totalSnapshot,
          expiresAt,
          openTicketsCount: ticketsToCreate.length,
          soldByOperatorId: operator.id,
          soldAt: now,
        },
      });

      // createManyAndReturn, а не createMany — реальный баг, найден
      // пользователем 2026-07-21: "при создании заказа они не сразу
      // появляются в табе Заказы... должны там быть сразу", не после
      // отдельного перезапроса ленты. Клиент подставляет вернувшиеся билеты
      // (с настоящими id — теми же, что нужны для гашения/аннулирования)
      // прямо в список без сетевого round-trip.
      const tickets = await tx.ticket.createManyAndReturn({
        data: ticketsToCreate.map((t) => ({ orderId: created.id, ...t })),
      });

      if (legs) {
        // Разбивка (запрос пользователя 2026-07-26) — списание балансовой
        // доли на её собственную сумму, не на весь заказ; остальные доли
        // (нал/безнал) для Билетов и так никогда не журналировались отдельно
        // от заказа — сама TicketOrderPaymentLeg-строка их фиксирует.
        for (const leg of legs) {
          if (leg.method === "abonement") {
            await spendWalletForTicketOrderTx(tx, leg.walletId!, {
              tenantId: point.tenantId,
              zoneId: zone.id,
              ticketOrderId: created.id,
              pointId: point.id,
              operatorId: operator.id,
              amount: leg.amount,
            });
          }
        }
        await tx.ticketOrderPaymentLeg.createMany({
          data: legs.map((leg, index) => ({
            orderId: created.id,
            method: leg.method,
            amount: leg.amount,
            walletId: leg.walletId,
            order: index,
          })),
        });
      } else if (paymentMethod === "abonement" && abonementWalletId) {
        await spendWalletForTicketOrderTx(tx, abonementWalletId, {
          tenantId: point.tenantId,
          zoneId: zone.id,
          ticketOrderId: created.id,
          pointId: point.id,
          operatorId: operator.id,
          amount: totalSnapshot,
        });
      }

      return { order: created, tickets };
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: "Недостаточно средств на абонементе" }, { status: 400 });
    }
    throw err;
  }

  if (legs) {
    const abonementLeg = legs.find((l) => l.method === "abonement");
    if (abonementLeg) {
      await notifyWalletBalanceChange(point.tenantId, abonementLeg.walletId!, -abonementLeg.amount).catch(() => {});
    }
  } else if (paymentMethod === "abonement" && abonementWalletId) {
    await notifyWalletBalanceChange(point.tenantId, abonementWalletId, -totalSnapshot).catch(() => {});
  }

  const { order, tickets } = result;
  return NextResponse.json(
    {
      id: order.id,
      number: order.number,
      paymentMethod: order.paymentMethod,
      totalSnapshot: Number(order.totalSnapshot),
      expiresAt: order.expiresAt,
      openTicketsCount: order.openTicketsCount,
      soldAt: order.soldAt,
      soldByOperatorName: operator.name,
      tickets: tickets.map((t) => ({
        id: t.id,
        assetId: t.assetId,
        variantNameSnapshot: t.variantNameSnapshot,
        priceSnapshot: Number(t.priceSnapshot),
        status: t.status,
        redeemedAt: t.redeemedAt,
      })),
    },
    { status: 201 }
  );
}
