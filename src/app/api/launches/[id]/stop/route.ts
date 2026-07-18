import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  computeLaunchAmount,
  LAUNCH_PAYMENT_METHODS,
  type LaunchPricingMode,
  type LaunchRoundingMode,
} from "@/lib/game-room";
import { InsufficientBalanceError, spendWalletTx } from "@/lib/abonement";

// Стоп пуска — оператор, серверное время; расчёт стоимости только на сервере
// (docs/spec/04-game-room.md), по снапшоту тарифа, зафиксированному при
// старте (см. /api/zones/[id]/launches POST), не по текущему тарифу зоны.
export async function POST(request: Request, ctx: RouteContext<"/api/launches/[id]/stop">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id } = await ctx.params;

  const launch = await prisma.launch.findUnique({ where: { id }, include: { zone: true } });
  if (!launch || launch.zone.pointId !== point.id) {
    return NextResponse.json({ error: "Пуск не найден" }, { status: 404 });
  }
  if (!launch.isOpen) {
    return NextResponse.json({ error: "Пуск уже завершён" }, { status: 400 });
  }
  if (!operator.allZonesAccess) {
    const hasAccess = await prisma.zone.findFirst({
      where: { id: launch.zoneId, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (!hasAccess) {
      return NextResponse.json({ error: "Нет доступа к этой зоне" }, { status: 403 });
    }
  }

  // Способ оплаты — только у "per_minute"/"По факту" спрашивается СЕЙЧАС,
  // при остановке (запрос пользователя 2026-07-17: "это только касается
  // тарифа По факту") — у "fixed"/"За вход" он уже известен, спрошен и
  // сохранён РАНЬШЕ, при старте (см. POST /api/zones/[id]/launches). Реальный
  // баг, найден пользователем 2026-07-18 через живой пуск "За вход": здесь
  // paymentMethod/abonementWalletId раньше безусловно перезаписывались
  // локальной переменной null для ЛЮБОГО режима — стоп "За вход"-пуска стирал
  // уже сохранённый способ оплаты, из-за чего разбивка Наличные/Безнал/
  // Абонемент по активу всегда показывала 0 у "За вход", хотя расчётная
  // выручка была верной. Для "fixed" сохраняем то, что уже записано на
  // самом пуске, вместо null.
  let paymentMethod: string | null = launch.paymentMethod;
  let abonementWalletId: string | null = launch.abonementWalletId;
  if (launch.pricingMode === "per_minute") {
    const body = await request.json().catch(() => ({}));
    if (!(LAUNCH_PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
      return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
    }
    paymentMethod = body.paymentMethod;
    if (paymentMethod === "abonement") {
      abonementWalletId =
        typeof body.abonementWalletId === "string" && body.abonementWalletId ? body.abonementWalletId : null;
      if (!abonementWalletId) {
        return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
      }
    } else {
      abonementWalletId = null;
    }
  }

  const endedAt = new Date();
  const amount = computeLaunchAmount(
    {
      pricingMode: launch.pricingMode as LaunchPricingMode,
      priceSnapshot: launch.priceSnapshot,
      durationMinutesSnapshot: launch.durationMinutesSnapshot,
      roundingModeSnapshot: launch.roundingModeSnapshot as LaunchRoundingMode | null,
      minAmountSnapshot: launch.minAmountSnapshot,
    },
    launch.startedAt,
    endedAt
  );

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const result = await tx.launch.update({
        where: { id },
        data: { endedAt, isOpen: false, amount, endedByOperatorId: operator.id, paymentMethod, abonementWalletId },
      });

      // Сумма "По факту" известна только сейчас, при остановке — списание
      // сразу здесь же, тем же принципом, что и "За вход" при старте.
      // ТОЛЬКО "per_minute" — у "fixed" списание уже прошло раньше, при
      // старте (см. POST /api/zones/[id]/launches), повторное списание тут
      // задвоило бы его.
      if (launch.pricingMode === "per_minute" && paymentMethod === "abonement" && abonementWalletId) {
        await spendWalletTx(tx, abonementWalletId, {
          tenantId: point.tenantId,
          zoneId: launch.zoneId,
          launchId: id,
          pointId: point.id,
          operatorId: operator.id,
          amount,
        });
      }

      return result;
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: "Недостаточно средств на абонементе" }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({
    id: updated.id,
    startedAt: updated.startedAt,
    endedAt: updated.endedAt,
    amount: Number(updated.amount),
  });
}
