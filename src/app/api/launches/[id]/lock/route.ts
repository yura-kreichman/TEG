import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { computeLaunchAmount, roundToWholeCurrencyUnit, type LaunchPricingMode, type LaunchRoundingMode } from "@/lib/game-room";

class LaunchNotOpenError extends Error {}

// Фиксация окончания пуска "По факту" В МОМЕНТ ОТКРЫТИЯ шторки выбора
// способа оплаты (запрос пользователя 2026-07-27: "пока Сотрудник или
// Клиент выбирают метод оплаты, сумма может стать больше") — endedAt/amount
// записываются здесь же, сразу, тем же серверным временем, что и обычный
// стоп (docs/spec/04-game-room.md: время всегда серверное, не клиентское,
// иначе можно задним числом занизить сумму). paymentMethod остаётся null —
// это промежуточное состояние "остановлен, ждёт способ оплаты", не полное
// завершение; довершает его POST /api/launches/[id]/stop (принимает такой
// пуск и просто дописывает paymentMethod, не трогая уже зафиксированные
// endedAt/amount), либо отменяет POST /api/launches/[id]/resume (см. его
// комментарий — единственный путь назад к isOpen:true).
export async function POST(_request: Request, ctx: RouteContext<"/api/launches/[id]/lock">) {
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
  if (!operator.allZonesAccess) {
    const hasAccess = await prisma.zone.findFirst({
      where: { id: launch.zoneId, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (!hasAccess) {
      return NextResponse.json({ error: "Нет доступа к этой зоне" }, { status: 403 });
    }
  }
  // Только "per_minute" — у "fixed" цена уже известна заранее, замораживать
  // нечего (там оплата спрашивается сразу при старте, см. /stop).
  if (launch.pricingMode !== "per_minute") {
    return NextResponse.json({ error: "Не применимо для этого тарифа" }, { status: 400 });
  }

  const endedAt = new Date();
  let amount = computeLaunchAmount(
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
  if (launch.zone.amountRoundingEnabled) {
    amount = roundToWholeCurrencyUnit(amount);
  }

  let updated;
  try {
    // CAS — двойной тап "Точно?" не должен зафиксировать endedAt дважды
    // разным временем (тот же класс гонки, что уже был у /stop).
    updated = await prisma.$transaction(async (tx) => {
      const result = await tx.launch.updateMany({
        where: { id, isOpen: true },
        data: { endedAt, isOpen: false, amount, endedByOperatorId: operator.id },
      });
      if (result.count === 0) throw new LaunchNotOpenError();
      return tx.launch.findUniqueOrThrow({ where: { id } });
    });
  } catch (err) {
    if (err instanceof LaunchNotOpenError) {
      return NextResponse.json({ error: "Пуск уже остановлен" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({
    id: updated.id,
    endedAt: updated.endedAt,
    amount: Number(updated.amount),
  });
}
