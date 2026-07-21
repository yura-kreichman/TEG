import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isTicketExpired } from "@/lib/tickets";

/**
 * Гашение билета — оператор с доступом к зоне (НЕ обязателен тумблер
 * "Продажа билетов" — тот гейтит только продажу, докс: "оператор с доступом
 * к зоне без тумблера гасит билеты"). Только при включённом гашении зоны —
 * при выключенном билеты вообще не имеют жизненного цикла статусов (докс,
 * "ГАШЕНИЕ — НАСТРОЙКА ЗОНЫ": "статусы не назначаются... без статусов и
 * кнопок"). Серверное время.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/tickets/[id]/redeem">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id } = await ctx.params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { order: { include: { zone: true } } },
  });
  if (!ticket || ticket.order.zone.pointId !== point.id) {
    return NextResponse.json({ error: "Билет не найден" }, { status: 404 });
  }
  if (!operator.allZonesAccess) {
    const hasAccess = await prisma.zone.findFirst({
      where: { id: ticket.order.zoneId, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (!hasAccess) {
      return NextResponse.json({ error: "Нет доступа к этой зоне" }, { status: 403 });
    }
  }
  if (!ticket.order.zone.ticketRedemptionEnabled) {
    return NextResponse.json({ error: "Гашение выключено для этой зоны" }, { status: 400 });
  }
  if (ticket.status !== "active") {
    return NextResponse.json({ error: "Билет уже погашен или аннулирован" }, { status: 400 });
  }
  if (isTicketExpired(ticket, ticket.order)) {
    return NextResponse.json({ error: "Срок действия билета истёк" }, { status: 400 });
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.ticket.update({
      where: { id },
      data: { status: "redeemed", redeemedAt: now, redeemedByOperatorId: operator.id },
    });
    await tx.ticketOrder.update({
      where: { id: ticket.orderId },
      data: { openTicketsCount: { decrement: 1 } },
    });
    return result;
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    redeemedAt: updated.redeemedAt,
    redeemedByOperatorName: operator.name,
  });
}
