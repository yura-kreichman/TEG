import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { computeLaunchAmount, type LaunchPricingMode, type LaunchRoundingMode } from "@/lib/game-room";

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

  const updated = await prisma.launch.update({
    where: { id },
    data: { endedAt, isOpen: false, amount, endedByOperatorId: operator.id },
  });

  return NextResponse.json({
    id: updated.id,
    startedAt: updated.startedAt,
    endedAt: updated.endedAt,
    amount: Number(updated.amount),
  });
}
