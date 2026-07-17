import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  LAUNCH_PAYMENT_METHODS,
  findOperatorLaunchesZone,
  gameRoomRevenueByAsset,
  launchesRevenueByAssetAndTariff,
  previousSubmissionBoundary,
} from "@/lib/game-room";

// "Пуски" (accountingMode="launches", запрос пользователя 2026-07-17:
// "тапали по активам и пуски учитывались" — цифровая замена бумажной
// тетрадки с плюсиками) — сколько пусков уже учтено с прошлой сдачи итогов,
// по каждой паре актив+тариф. Опрашивается тем же интервалом, что и живой
// экран "Прибываний" — тайл актива показывает счётчик.
export async function GET(_request: Request, ctx: RouteContext<"/api/zones/[id]/tally">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id: zoneId } = await ctx.params;

  const zone = await findOperatorLaunchesZone(zoneId, point.id, operator);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(zone.id);
  const now = new Date();
  const entries = await launchesRevenueByAssetAndTariff(zone.id, boundary, now);
  // Наличные/безнал по активу (запрос пользователя 2026-07-17: "это общее
  // правило для двух типов тарификации") — та же функция, что и у
  // "Прибываний" в мастере сдачи итогов: она работает по сырым Launch-
  // записям (assetId+amount+paymentMethod), тарифная привязка ей не важна.
  const revenueByAsset = await gameRoomRevenueByAsset(zone.id, boundary, now);

  return NextResponse.json({ entries, revenueByAsset });
}

// Тап по активу — мгновенно учитывает один пуск: старт и стоп в один момент
// (docs/spec/01-counters.md, "launches" — фиксированная цена за событие, не
// сессия во времени). Тариф не привязан к активу заранее (запрос
// пользователя 2026-07-17) — оператор выбирает один из до-двух тарифов
// зоны на каждом тапе. Способ оплаты — сразу, цена известна заранее (тот же
// принцип, что "За вход" у "Прибываний").
export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/tally">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id: zoneId } = await ctx.params;

  const zone = await findOperatorLaunchesZone(zoneId, point.id, operator);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const assetId: string | null = typeof body.assetId === "string" && body.assetId ? body.assetId : null;
  const tariffId: string | null = typeof body.tariffId === "string" && body.tariffId ? body.tariffId : null;

  if (!assetId || !zone.assets.some((a) => a.id === assetId)) {
    return NextResponse.json({ error: "Выберите актив" }, { status: 400 });
  }
  const tariff = zone.tariffs.find((t) => t.id === tariffId);
  if (!tariff) {
    return NextResponse.json({ error: "Выберите тариф" }, { status: 400 });
  }
  if (!(LAUNCH_PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
    return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
  }
  const paymentMethod: string = body.paymentMethod;

  const now = new Date();
  const launch = await prisma.launch.create({
    data: {
      zoneId: zone.id,
      assetId,
      tariffId: tariff.id,
      // Число не показывается оператору в этом режиме (тап мгновенный, нет
      // "текущего браслета/пуска" на экране) — 1 у каждой записи, реальный
      // счётчик считается агрегатом (launchesRevenueByAssetAndTariff), не
      // этим полем.
      number: 1,
      startedAt: now,
      endedAt: now,
      isOpen: false,
      pricingMode: "fixed",
      priceSnapshot: tariff.price,
      amount: tariff.price,
      paymentMethod,
      startedByOperatorId: operator.id,
      endedByOperatorId: operator.id,
    },
  });

  return NextResponse.json(
    {
      id: launch.id,
      assetId: launch.assetId,
      tariffId: launch.tariffId,
      amount: Number(launch.amount),
    },
    { status: 201 }
  );
}
