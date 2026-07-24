import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";
import { getZoneAbonementSpendAmount } from "@/lib/abonement";

/**
 * "Счётчики"/"Только касса" — сумма, оплаченная с баланса клиента с момента
 * предыдущей сдачи итогов (реальный баг, найден пользователем 2026-07-24:
 * живой предпросмотр "Разница" в мастере сдачи итогов её не знал — в отличие
 * от serve-стороны submit-results/route.ts, которая уже учитывает её в
 * формуле, — сотрудник видел на экране один расчёт, а после отправки сервер
 * показывал другой. Тот же принцип, что у /api/zones/[id]/ticket-orders?
 * aggregate=1 у Билетов: превью гарантированно совпадёт с тем, что реально
 * посчитается при отправке, потому что источник (getZoneAbonementSpendAmount
 * + previousSubmissionBoundary) буквально тот же самый.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/zones/[id]/abonement-amount">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id: zoneId } = await ctx.params;

  const zone = await prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId: point.id,
      active: true,
      accountingMode: { in: ["counters", "cash_only"] },
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    select: { id: true },
  });
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(zone.id);
  const amount = await getZoneAbonementSpendAmount(zone.id, boundary);

  return NextResponse.json({ amount });
}
