import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  LAUNCH_PAYMENT_METHODS,
  countOpenLaunches,
  findOperatorLaunchesZone,
  gameRoomRevenueByAsset,
  launchesRevenueByAssetAndTariff,
  previousSubmissionBoundary,
} from "@/lib/game-room";
import { InsufficientBalanceError, spendWalletTx, notifyWalletBalanceChange } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { PAYMENT_SPLIT_METHOD, validateSplitLegs, InvalidPaymentSplitError, type PaymentLegInput } from "@/lib/payment-split";

class AssetBusyError extends Error {}

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

  // Открытые (таймерные) пуски "Пусков" (запрос пользователя 2026-07-28) —
  // тот же принцип "За вход" у "Прибываний": тариф с вариантами длительности
  // не закрывает пуск мгновенно, а держит его открытым с обратным отсчётом,
  // пока Сотрудник не остановит (досрочно) или не "освободит" актив тапом
  // после истечения (см. POST ниже и /api/launches/[id]/stop). В отличие от
  // "Прибываний" здесь не бывает больше одного открытого пуска на актив —
  // тайл актива, а не список появляющихся браслетов.
  const openLaunches = await prisma.launch.findMany({
    where: { zoneId: zone.id, isOpen: true },
    orderBy: { startedAt: "asc" },
  });

  return NextResponse.json({
    entries,
    revenueByAsset,
    openLaunches: openLaunches.map((l) => ({
      id: l.id,
      assetId: l.assetId,
      tariffId: l.tariffId,
      startedAt: l.startedAt,
      priceSnapshot: Number(l.priceSnapshot),
      durationMinutesSnapshot: l.durationMinutesSnapshot,
    })),
  });
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
  // Вариант длительности (запрос пользователя 2026-07-28) — только у
  // тарифов "Пусков" с pricingMode="fixed" (та же механика "За вход", что у
  // "Прибываний"). Обычный мгновенный тариф (pricingMode=null) его не
  // требует — see "timed" branch check below.
  const optionId: string | null = typeof body.optionId === "string" && body.optionId ? body.optionId : null;
  // Разбивка оплаты (аудит 2026-07-26: "по всем модулям, по всем методам
  // оплаты" — этот тап-режим "Пусков" остался единственным непокрытым) —
  // тот же приём, что у fixed-варианта /api/zones/[id]/launches: цена
  // известна заранее (tariff.price), поэтому разбивка возможна сразу.
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

  if (!assetId || !zone.assets.some((a) => a.id === assetId)) {
    return NextResponse.json({ error: "Выберите актив" }, { status: 400 });
  }
  const tariff = zone.tariffs.find((t) => t.id === tariffId);
  if (!tariff) {
    return NextResponse.json({ error: "Выберите тариф" }, { status: 400 });
  }

  // Таймерный тариф "Пусков" (запрос пользователя 2026-07-28: "10 руб. за 10
  // минут, 15 руб. за 20 минут") — вместо мгновенного тапа открывает пуск с
  // обратным отсчётом (см. ветку транзакции ниже), закрывается позже через
  // /api/launches/[id]/stop, не здесь.
  const isTimed = tariff.pricingMode === "fixed";
  let option: (typeof tariff.options)[number] | null = null;
  if (isTimed) {
    if (!optionId) {
      return NextResponse.json({ error: "Выберите вариант тарифа" }, { status: 400 });
    }
    option = tariff.options.find((o) => o.id === optionId) ?? null;
    if (!option) {
      return NextResponse.json({ error: "Вариант тарифа не найден" }, { status: 400 });
    }
  }
  const priceForPayment = isTimed ? Number(option!.price) : Number(tariff.price);

  let paymentMethod: string;
  let abonementWalletId: string | null = null;
  if (legs) {
    try {
      validateSplitLegs(legs, priceForPayment, LAUNCH_PAYMENT_METHODS);
    } catch (err) {
      if (err instanceof InvalidPaymentSplitError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    paymentMethod = PAYMENT_SPLIT_METHOD;
    if (legs.some((l) => l.method === "abonement") && !(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
      return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
    }
  } else {
    if (!(LAUNCH_PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
      return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
    }
    paymentMethod = body.paymentMethod;
    abonementWalletId =
      typeof body.abonementWalletId === "string" && body.abonementWalletId ? body.abonementWalletId : null;
    if (paymentMethod === "abonement") {
      if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
        return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
      }
      if (!abonementWalletId) {
        return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
      }
    }
  }

  const now = new Date();
  let launch;
  try {
    launch = await prisma.$transaction(async (tx) => {
      if (isTimed) {
        // Актив держит не больше одного открытого таймерного пуска разом
        // (запрос пользователя 2026-07-28: "машинка физически одна и катает
        // одного ребёнка за раз") — advisory-лок по assetId, тот же приём,
        // что nextLaunchNumber у "Прибываний", проверка ПОСЛЕ захвата лока
        // исключает гонку двух одновременных тапов по одному активу.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assetId}))`;
        const openCount = await countOpenLaunches(assetId, tx);
        if (openCount > 0) throw new AssetBusyError();
      }

      const created = await tx.launch.create({
        data: {
          zoneId: zone.id,
          assetId,
          tariffId: tariff.id,
          // Число не показывается оператору в этом режиме (нет "текущего
          // браслета" на экране, тайл — сам актив) — 1 у каждой записи,
          // реальный счётчик считается агрегатом
          // (launchesRevenueByAssetAndTariff), не этим полем.
          number: 1,
          startedAt: now,
          endedAt: isTimed ? null : now,
          isOpen: isTimed,
          pricingMode: "fixed",
          priceSnapshot: isTimed ? option!.price : tariff.price,
          durationMinutesSnapshot: isTimed ? option!.durationMinutes : null,
          amount: isTimed ? null : tariff.price,
          paymentMethod,
          abonementWalletId: !legs && paymentMethod === "abonement" ? abonementWalletId : null,
          startedByOperatorId: operator.id,
          endedByOperatorId: isTimed ? null : operator.id,
        },
      });

      if (legs) {
        for (const leg of legs) {
          if (leg.method === "abonement") {
            await spendWalletTx(tx, leg.walletId!, {
              tenantId: point.tenantId,
              zoneId: zone.id,
              launchId: created.id,
              pointId: point.id,
              operatorId: operator.id,
              amount: leg.amount,
            });
          }
        }
        await tx.launchPaymentLeg.createMany({
          data: legs.map((leg, index) => ({
            launchId: created.id,
            method: leg.method,
            amount: leg.amount,
            walletId: leg.walletId,
            order: index,
          })),
        });
      } else if (paymentMethod === "abonement" && abonementWalletId) {
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
    if (err instanceof AssetBusyError) {
      return NextResponse.json({ error: "Актив уже занят текущим пуском" }, { status: 409 });
    }
    throw err;
  }

  if (legs) {
    const abonementLeg = legs.find((l) => l.method === "abonement");
    if (abonementLeg) {
      await notifyWalletBalanceChange(point.tenantId, abonementLeg.walletId!, -abonementLeg.amount).catch(() => {});
    }
  } else if (launch.paymentMethod === "abonement" && launch.abonementWalletId) {
    // priceSnapshot, не amount (null у ещё открытого таймерного пуска —
    // сумма спишется/зафиксируется на старте всё равно, платёж уже прошёл
    // выше в spendWalletTx, здесь только уведомление об изменении баланса).
    await notifyWalletBalanceChange(point.tenantId, launch.abonementWalletId, -Number(launch.priceSnapshot)).catch(() => {});
  }

  return NextResponse.json(
    {
      id: launch.id,
      assetId: launch.assetId,
      tariffId: launch.tariffId,
      amount: launch.amount != null ? Number(launch.amount) : null,
      isOpen: launch.isOpen,
      startedAt: launch.startedAt,
      durationMinutesSnapshot: launch.durationMinutesSnapshot,
      priceSnapshot: Number(launch.priceSnapshot),
    },
    { status: 201 }
  );
}
