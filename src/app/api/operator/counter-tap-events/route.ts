import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";
import { isCountersZone } from "@/lib/results-calc";
import { InsufficientBalanceError, spendWalletForZone, notifyWalletBalanceChange } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { PAYMENT_SPLIT_METHOD, validateSplitLegs, InvalidPaymentSplitError, type PaymentLegInput } from "@/lib/payment-split";

/**
 * Тап "Пуск" в зоне "Счётчики" с включённым Zone.countersTapAssistEnabled
 * (запрос пользователя 2026-07-25: "то, что Сотрудник натапал, и является
 * прибавкой к счётчику") — тот же принцип, что у /api/operator/zone-return-
 * events: лёгкий журнал событий, "текущий период" зоны — всё, что накопилось
 * ПОСЛЕ последней сдачи (previousSubmissionBoundary), сдача итогов сама
 * сворачивает эти записи в показание (см. submit-results/route.ts). В
 * отличие от возвратов — считается по паре актив+тариф, не по зоне целиком:
 * показание ведётся отдельно на каждый программный счётчик актива.
 */
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id, active: true }
    : { pointId: point.id, active: true, operatorsWithAccess: { some: { id: operator.id } } };

  const zones = await prisma.zone.findMany({
    where: { ...zoneWhere, accountingMode: "counters", countersTapAssistEnabled: true },
    select: {
      id: true,
      name: true,
      iconKey: true,
      tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" }, select: { id: true, name: true, price: true } },
      assets: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, iconKey: true, photoUrl: true, colorTag: true, active: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (zones.length === 0) {
    return NextResponse.json({ zones: [], counts: [] });
  }

  const boundaries = await Promise.all(zones.map((z) => previousSubmissionBoundary(z.id)));
  const boundaryByZone = new Map(zones.map((z, i) => [z.id, boundaries[i]]));

  const events = await prisma.counterTapEvent.findMany({
    where: {
      zoneId: { in: zones.map((z) => z.id) },
      // Каждая зона фильтруется по СВОЕЙ границе — нельзя одним OR-условием
      // на всю выборку, у зон разные предыдущие сдачи.
      OR: zones.map((z) => ({ zoneId: z.id, createdAt: { gt: boundaryByZone.get(z.id) ?? new Date(0) } })),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, zoneId: true, assetId: true, tariffId: true, paymentMethod: true, voidedAt: true, createdAt: true },
  });

  // Показание считает ВСЕ тапы (запрос пользователя 2026-07-25: реальный
  // счётчик тикнул бы и на тестовом/возвратном заезде) — voidedAt тут не
  // фильтруется, тот же принцип, что submit-results/route.ts.
  const countByKey = new Map<string, number>();
  for (const e of events) {
    const key = `${e.assetId}:${e.tariffId}`;
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  const nameByAsset = new Map(zones.flatMap((z) => z.assets.map((a) => [a.id, a.name])));
  const nameByTariff = new Map(zones.flatMap((z) => z.tariffs.map((t) => [t.id, t.name])));

  // Расчётная разбивка Наличные/Безнал/Баланс (запрос пользователя 2026-07-25:
  // "не видно сколько по наличному и безналичному") — та же роль, что
  // gameRoomRevenueByAsset у "Пусков"/"Прибываний": только справочная
  // подсказка Сотруднику при вводе кассы на Сдаче итогов, НЕ автозаполнение
  // (касса по-прежнему вводится вручную, сверка факта с расчётом должна
  // оставаться реальной проверкой). Тапы без paymentMethod (сделанные до
  // этого поля) в разбивку не попадают. voidedAt (запрос пользователя
  // 2026-07-25: "у конкретных активов был выбран конкретный метод оплаты" —
  // возврат/тест привязан к конкретному тапу, а не размазан пропорционально
  // между способами оплаты) — воид-тап полностью исключён из подсказки,
  // именно из СВОЕГО способа оплаты, а не из общей суммы наугад.
  const priceByKey = new Map<string, number>();
  for (const z of zones) {
    for (const t of z.tariffs) priceByKey.set(`${z.id}:${t.id}`, Number(t.price));
  }
  const breakdownByZone = new Map<string, { cashAmount: number; mobileAmount: number; abonementAmount: number }>();
  const splitTapZoneById = new Map<string, string>();
  for (const e of events) {
    if (e.voidedAt) continue;
    if (e.paymentMethod === "split") {
      splitTapZoneById.set(e.id, e.zoneId);
      continue;
    }
    if (e.paymentMethod !== "cash" && e.paymentMethod !== "mobile" && e.paymentMethod !== "abonement") continue;
    const price = priceByKey.get(`${e.zoneId}:${e.tariffId}`) ?? 0;
    const entry = breakdownByZone.get(e.zoneId) ?? { cashAmount: 0, mobileAmount: 0, abonementAmount: 0 };
    if (e.paymentMethod === "cash") entry.cashAmount += price;
    else if (e.paymentMethod === "mobile") entry.mobileAmount += price;
    else entry.abonementAmount += price;
    breakdownByZone.set(e.zoneId, entry);
  }
  // Разбивка оплаты (запрос пользователя 2026-07-26) — та же подсказка, что
  // и обычный paymentMethod выше, просто сумма приходит из нескольких долей.
  if (splitTapZoneById.size > 0) {
    const legs = await prisma.counterTapEventPaymentLeg.findMany({ where: { tapId: { in: [...splitTapZoneById.keys()] } } });
    for (const leg of legs) {
      const zId = splitTapZoneById.get(leg.tapId);
      if (!zId) continue;
      const entry = breakdownByZone.get(zId) ?? { cashAmount: 0, mobileAmount: 0, abonementAmount: 0 };
      const legAmount = Number(leg.amount);
      if (leg.method === "cash") entry.cashAmount += legAmount;
      else if (leg.method === "mobile") entry.mobileAmount += legAmount;
      else if (leg.method === "abonement") entry.abonementAmount += legAmount;
      breakdownByZone.set(zId, entry);
    }
  }

  return NextResponse.json({
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      iconKey: z.iconKey,
      tariffs: z.tariffs.map((t) => ({ id: t.id, name: t.name, price: Number(t.price) })),
      assets: z.assets,
    })),
    counts: [...countByKey.entries()].map(([key, count]) => {
      const [assetId, tariffId] = key.split(":");
      return { assetId, tariffId, count };
    }),
    paymentBreakdown: [...breakdownByZone.entries()].map(([zoneId, b]) => ({
      zoneId,
      cashAmount: Math.round(b.cashAmount * 100) / 100,
      mobileAmount: Math.round(b.mobileAmount * 100) / 100,
      abonementAmount: Math.round(b.abonementAmount * 100) / 100,
    })),
    // Список тапов текущего периода — для шторки "Возврат/тест" (запрос
    // пользователя 2026-07-25: пометить КОНКРЕТНЫЙ тап, не зонный счётчик) и
    // для истории/отмены на самом экране "Счётчики". take 100 на зону было
    // бы честнее, но общий список редко превышает пару десятков за период —
    // не усложняем лимитом, пока это реальная проблема.
    recentTaps: events.map((e) => ({
      id: e.id,
      zoneId: e.zoneId,
      assetId: e.assetId,
      assetName: nameByAsset.get(e.assetId) ?? "",
      tariffId: e.tariffId,
      tariffName: nameByTariff.get(e.tariffId) ?? "",
      paymentMethod: e.paymentMethod,
      voidedAt: e.voidedAt,
      createdAt: e.createdAt,
    })),
    // Кнопка "Баланс" на способе оплаты тапа (запрос пользователя 2026-07-25) —
    // тот же тумблер, что уже гейтит "Списать с баланса"/весь модуль Клиенты.
    clientsEnabled: await isModuleEnabled(point.tenantId, "clientsEnabled"),
  });
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;
  const body = await request.json().catch(() => null);
  const zoneId = body?.zoneId;
  const assetId = body?.assetId;
  const tariffId = body?.tariffId;
  if (typeof zoneId !== "string" || !zoneId || typeof assetId !== "string" || !assetId || typeof tariffId !== "string" || !tariffId) {
    return NextResponse.json({ error: "Не указана зона, актив или тариф" }, { status: 400 });
  }
  // Способ оплаты (запрос пользователя 2026-07-25) — необязателен (старые
  // тапы его не знают вовсе). cash/mobile — только пометка (та же логика,
  // что Launch.paymentMethod: НЕ подставляется в кассу зоны). abonement —
  // реальное списание, происходит НИЖЕ, тем же кодом, что у "Списать с
  // баланса" (spendWalletForZone), одним запросом с созданием тапа.
  const paymentMethod: string | null =
    body?.paymentMethod === "cash" || body?.paymentMethod === "mobile" || body?.paymentMethod === "abonement"
      ? body.paymentMethod
      : null;
  if (body?.paymentMethod !== undefined && paymentMethod === null) {
    return NextResponse.json({ error: "Некорректный способ оплаты" }, { status: 400 });
  }
  const abonementWalletId: string | null =
    paymentMethod === "abonement" && typeof body?.abonementWalletId === "string" && body.abonementWalletId
      ? body.abonementWalletId
      : null;
  if (paymentMethod === "abonement" && !abonementWalletId) {
    return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
  }
  // Разбивка оплаты (запрос пользователя 2026-07-26) — как и paymentMethod,
  // необязательная.
  const legs: PaymentLegInput[] | undefined = Array.isArray(body?.legs)
    ? (body.legs as unknown[]).map((raw) => {
        const l = raw as { method?: unknown; amount?: unknown; walletId?: unknown };
        return {
          method: typeof l?.method === "string" ? l.method : "",
          amount: Number(l?.amount),
          walletId: typeof l?.walletId === "string" ? l.walletId : undefined,
        };
      })
    : undefined;

  const zone = await prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId: point.id,
      active: true,
      countersTapAssistEnabled: true,
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    select: {
      id: true,
      accountingMode: true,
      assets: { where: { id: assetId, active: true }, select: { id: true } },
      tariffs: { where: { id: tariffId, deletedAt: null }, select: { id: true, price: true } },
    },
  });
  if (!zone || !isCountersZone(zone) || zone.assets.length === 0 || zone.tariffs.length === 0) {
    return NextResponse.json({ error: "Зона, актив или тариф не найдены" }, { status: 404 });
  }

  const usesBalance = legs ? legs.some((l) => l.method === "abonement") : paymentMethod === "abonement";
  if (usesBalance && !(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
  }

  if (legs) {
    try {
      validateSplitLegs(legs, Number(zone.tariffs[0]!.price), ["cash", "mobile", "abonement"]);
    } catch (err) {
      if (err instanceof InvalidPaymentSplitError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    try {
      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.counterTapEvent.create({
          data: { zoneId: zone.id, pointId: point.id, assetId, tariffId, operatorId: operator.id, paymentMethod: PAYMENT_SPLIT_METHOD },
        });
        for (const leg of legs) {
          if (leg.method === "abonement") {
            const updated = await tx.abonementWallet.updateMany({
              where: { id: leg.walletId, tenantId: point.tenantId, balance: { gte: leg.amount } },
              data: { balance: { decrement: leg.amount } },
            });
            if (updated.count === 0) throw new InsufficientBalanceError();
            await tx.abonementTransaction.create({
              data: {
                walletId: leg.walletId!,
                type: "spend",
                amount: leg.amount,
                tariffId,
                quantity: 1,
                pointId: point.id,
                operatorId: operator.id,
              },
            });
            await tx.moneyOperation.create({
              data: { tenantId: point.tenantId, zoneId: zone.id, type: "revenue_abonement", amount: leg.amount, performedByOperatorId: operator.id },
            });
          }
        }
        await tx.counterTapEventPaymentLeg.createMany({
          data: legs.map((leg, index) => ({
            tapId: created.id,
            method: leg.method,
            amount: leg.amount,
            walletId: leg.walletId,
            order: index,
          })),
        });
        return created;
      });

      const abonementLeg = legs.find((l) => l.method === "abonement");
      if (abonementLeg) {
        await notifyWalletBalanceChange(point.tenantId, abonementLeg.walletId!, -abonementLeg.amount).catch(() => {});
      }
      return NextResponse.json({ id: event.id, zoneId: event.zoneId, assetId: event.assetId, tariffId: event.tariffId, createdAt: event.createdAt });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return NextResponse.json({ error: "Недостаточно средств на абонементе" }, { status: 400 });
      }
      throw err;
    }
  }

  if (paymentMethod === "abonement" && abonementWalletId) {
    try {
      await spendWalletForZone(abonementWalletId, {
        tenantId: point.tenantId,
        pointId: point.id,
        operatorId: operator.id,
        target: { kind: "counterTariff", zoneId: zone.id, lines: [{ tariffId, quantity: 1 }] },
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return NextResponse.json({ error: "Недостаточно средств на абонементе" }, { status: 400 });
      }
      throw err;
    }
  }

  const event = await prisma.counterTapEvent.create({
    data: { zoneId: zone.id, pointId: point.id, assetId, tariffId, operatorId: operator.id, paymentMethod, abonementWalletId },
  });
  return NextResponse.json({ id: event.id, zoneId: event.zoneId, assetId: event.assetId, tariffId: event.tariffId, createdAt: event.createdAt });
}
