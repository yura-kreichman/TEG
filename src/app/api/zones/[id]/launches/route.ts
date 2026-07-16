import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { MAX_PARALLEL_LAUNCHES, countOpenLaunches, findOperatorGameRoomZone, getLaunchPricingAt, nextLaunchNumber } from "@/lib/game-room";

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

  const zone = await findOperatorGameRoomZone(zoneId, point.id, operator);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const launches = await prisma.launch.findMany({
    where: { zoneId: zone.id, isOpen: true },
    orderBy: { startedAt: "asc" },
  });

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

  const zone = await findOperatorGameRoomZone(zoneId, point.id, operator);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const assetId: string | null = typeof body.assetId === "string" && body.assetId ? body.assetId : null;
  const label: string | null =
    typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null;

  // Тариф — свойство актива (запрос пользователя 2026-07-16: "2 игровые
  // комнаты — это активы", у каждой своя цена), поэтому пуск без актива
  // невозможен в принципе — не откуда взять тариф. Зона без активов не может
  // работать в режиме "Игровая комната" (владелец сначала заводит хотя бы один).
  if (!assetId || !zone.assets.some((a) => a.id === assetId)) {
    return NextResponse.json({ error: "Выберите актив" }, { status: 400 });
  }

  const now = new Date();
  const pricing = await getLaunchPricingAt(assetId, now);
  if (!pricing) {
    return NextResponse.json({ error: "Тариф этого актива ещё не задан владельцем" }, { status: 400 });
  }

  const openCount = await countOpenLaunches(assetId);
  if (openCount >= MAX_PARALLEL_LAUNCHES) {
    return NextResponse.json(
      { error: `Слишком много одновременных пусков (максимум ${MAX_PARALLEL_LAUNCHES})` },
      { status: 400 }
    );
  }

  const launch = await prisma.$transaction(async (tx) => {
    const number = await nextLaunchNumber(tx, assetId);
    return tx.launch.create({
      data: {
        zoneId: zone.id,
        assetId,
        number,
        label,
        startedAt: now,
        isOpen: true,
        pricingMode: pricing.pricingMode,
        priceSnapshot: pricing.price,
        durationMinutesSnapshot: pricing.durationMinutes,
        roundingModeSnapshot: pricing.roundingMode,
        minAmountSnapshot: pricing.minAmount,
        startedByOperatorId: operator.id,
      },
    });
  });

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
