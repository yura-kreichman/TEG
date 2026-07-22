import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  LAUNCH_PAYMENT_METHODS,
  MAX_PARALLEL_LAUNCHES,
  countOpenLaunches,
  findOperatorStaysZone,
  gameRoomRevenueByAsset,
  getAssetTariff,
  nextLaunchNumber,
  previousSubmissionBoundary,
} from "@/lib/game-room";
import { InsufficientBalanceError, spendWalletTx, notifyWalletBalanceChange } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Список открытых пусков зоны — для экрана зоны в PWA (тайлы с активными
// пусками) и восстановления таймеров после перезапуска/смены устройства
// (docs/spec/04-game-room.md, "Пуск": источник времени сервер).
export async function GET(request: Request, ctx: RouteContext<"/api/zones/[id]/launches">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id: zoneId } = await ctx.params;

  const zone = await findOperatorStaysZone(zoneId, point.id, operator);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const launches = await prisma.launch.findMany({
    where: { zoneId: zone.id, isOpen: true },
    orderBy: { startedAt: "asc" },
  });

  // Расчётная выручка по каждому активу за текущее окно (с последней сдачи
  // итогов) — только по явному запросу (мастер сдачи итогов, карточка
  // актива), не на каждом 6-секундном опросе экрана зоны, которому эти
  // суммы не нужны (docs/spec/04-game-room.md).
  const url = new URL(request.url);
  const revenueByAsset =
    url.searchParams.get("cashSplit") === "1"
      ? await (async () => {
          const boundary = await previousSubmissionBoundary(zone.id);
          return gameRoomRevenueByAsset(zone.id, boundary, new Date());
        })()
      : undefined;

  return NextResponse.json({
    launches: launches.map((l) => ({
      id: l.id,
      assetId: l.assetId,
      number: l.number,
      label: l.label,
      startedAt: l.startedAt,
      pricingMode: l.pricingMode,
      priceSnapshot: Number(l.priceSnapshot),
      durationMinutesSnapshot: l.durationMinutesSnapshot,
      roundingModeSnapshot: l.roundingModeSnapshot,
      minAmountSnapshot: l.minAmountSnapshot != null ? Number(l.minAmountSnapshot) : null,
    })),
    ...(revenueByAsset ? { revenueByAsset } : {}),
  });
}

// Старт пуска — оператор, серверное время (docs/spec/04-game-room.md).
// Стоимость не считается здесь — только при стопе (см. /api/launches/[id]/stop),
// но тариф фиксируется снапшотом уже сейчас (на момент старта), не при стопе.
export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/launches">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id: zoneId } = await ctx.params;

  const zone = await findOperatorStaysZone(zoneId, point.id, operator);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const assetId: string | null = typeof body.assetId === "string" && body.assetId ? body.assetId : null;
  const label: string | null =
    typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null;
  const optionId: string | null = typeof body.optionId === "string" && body.optionId ? body.optionId : null;
  const abonementWalletId: string | null =
    typeof body.abonementWalletId === "string" && body.abonementWalletId ? body.abonementWalletId : null;

  // Тариф — свойство актива (запрос пользователя 2026-07-16: "2 игровые
  // комнаты — это активы", у каждой своя цена), поэтому пуск без актива
  // невозможен в принципе — не откуда взять тариф. Зона без активов не может
  // работать в режиме "Прибывания" (владелец сначала заводит хотя бы один).
  if (!assetId || !zone.assets.some((a) => a.id === assetId)) {
    return NextResponse.json({ error: "Выберите актив" }, { status: 400 });
  }

  const now = new Date();
  const pricing = await getAssetTariff(assetId);
  if (!pricing || !pricing.pricingMode) {
    return NextResponse.json({ error: "Тариф этого актива ещё не задан владельцем" }, { status: 400 });
  }
  const pricingMode = pricing.pricingMode;

  // "За вход" — несколько вариантов длительность+цена на тариф (запрос
  // пользователя 2026-07-17: "1 час, 2 часа..." — выбор оператора при
  // старте), снапшот берётся с выбранного варианта, не с самого Tariff.
  let priceSnapshot: Prisma.Decimal | number = pricing.price;
  let durationMinutesSnapshot: number | null = null;
  // Способ оплаты — у "fixed"/"За вход" спрашивается СРАЗУ при старте (цена
  // известна заранее, деньги логично брать при выдаче браслета, запрос
  // пользователя 2026-07-17), у "per_minute"/"По факту" наоборот — при
  // остановке (см. /api/launches/[id]/stop), сумма известна только тогда.
  let paymentMethod: string | null = null;
  if (pricingMode === "fixed") {
    if (!optionId) {
      return NextResponse.json({ error: "Выберите вариант тарифа" }, { status: 400 });
    }
    const option = await prisma.tariffOption.findFirst({ where: { id: optionId, tariffId: pricing.id } });
    if (!option) {
      return NextResponse.json({ error: "Вариант тарифа не найден" }, { status: 400 });
    }
    priceSnapshot = option.price;
    durationMinutesSnapshot = option.durationMinutes;

    if (!(LAUNCH_PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
      return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
    }
    paymentMethod = body.paymentMethod;
    if (paymentMethod === "abonement") {
      if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
        return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
      }
      if (!abonementWalletId) {
        return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
      }
    }
  }

  const openCount = await countOpenLaunches(assetId);
  if (openCount >= MAX_PARALLEL_LAUNCHES) {
    return NextResponse.json(
      { error: `Слишком много одновременных пусков (максимум ${MAX_PARALLEL_LAUNCHES})` },
      { status: 400 }
    );
  }

  let launch;
  try {
    launch = await prisma.$transaction(async (tx) => {
      const number = await nextLaunchNumber(tx, assetId);
      const created = await tx.launch.create({
        data: {
          zoneId: zone.id,
          assetId,
          number,
          label,
          startedAt: now,
          isOpen: true,
          pricingMode,
          priceSnapshot,
          durationMinutesSnapshot,
          roundingModeSnapshot: pricing.roundingMode,
          minAmountSnapshot: pricing.minAmount,
          paymentMethod,
          abonementWalletId: paymentMethod === "abonement" ? abonementWalletId : null,
          startedByOperatorId: operator.id,
        },
      });

      // Списание сразу при старте — "За вход" известна цена заранее, деньги
      // логично брать при выдаче браслета (тот же момент, что и наличные/
      // безнал, запрос пользователя 2026-07-17).
      if (paymentMethod === "abonement" && abonementWalletId) {
        await spendWalletTx(tx, abonementWalletId, {
          tenantId: point.tenantId,
          zoneId: zone.id,
          launchId: created.id,
          pointId: point.id,
          operatorId: operator.id,
          amount: Number(created.priceSnapshot),
        });
      }

      return created;
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: "Недостаточно средств на абонементе" }, { status: 400 });
    }
    throw err;
  }

  if (paymentMethod === "abonement" && launch.abonementWalletId) {
    await notifyWalletBalanceChange(point.tenantId, launch.abonementWalletId, -Number(launch.priceSnapshot)).catch(() => {});
  }

  return NextResponse.json({
    id: launch.id,
    assetId: launch.assetId,
    number: launch.number,
    label: launch.label,
    startedAt: launch.startedAt,
    pricingMode: launch.pricingMode,
    priceSnapshot: Number(launch.priceSnapshot),
    durationMinutesSnapshot: launch.durationMinutesSnapshot,
    roundingModeSnapshot: launch.roundingModeSnapshot,
    minAmountSnapshot: launch.minAmountSnapshot != null ? Number(launch.minAmountSnapshot) : null,
  });
}
