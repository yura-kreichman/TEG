import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { requireOperator } from "@/lib/require-operator";
import { voidTicketInTx } from "@/lib/tickets";
import { notifyWalletBalanceChange } from "@/lib/abonement";

/**
 * "Аннулировать заказ" — кнопка-удобство, аннулирует РАЗОМ все живые
 * (status="active") билеты заказа (docs/spec/10-tickets.md, "АННУЛИРОВАНИЕ":
 * "«Аннулировать заказ» = все живые билеты разом"). Один CorrectionLog на
 * весь заказ (entityType="TicketOrder"), не по записи на билет — это
 * действие пользователя одно, а не N независимых.
 *
 * Владелец — без ограничений, любой способ оплаты. Оператор с доступом к
 * продаже билетов — ТОЛЬКО заказы, оплаченные балансом (запрос пользователя
 * 2026-07-21, тот же принцип, что /api/tickets/[id]/void — см. его
 * комментарий).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/ticket-orders/[id]/void">) {
  const opCtx = await requireOperator();
  const owner = opCtx ? null : await requireOwner();
  if (!opCtx && !owner) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const order = await prisma.ticketOrder.findUnique({
    where: { id },
    include: {
      zone: { include: { point: true, operatorsWithAccess: { select: { id: true } } } },
      tickets: true,
    },
  });
  const tenantId = opCtx ? opCtx.point.tenantId : owner!.tenantId;
  if (!order || order.zone.point.tenantId !== tenantId) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  if (opCtx) {
    const { operator, point } = opCtx;
    if (order.zone.pointId !== point.id) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    if (!operator.ticketsAccess) {
      return NextResponse.json({ error: "Нет доступа к продаже билетов" }, { status: 403 });
    }
    const hasZoneAccess = operator.allZonesAccess || order.zone.operatorsWithAccess.some((o) => o.id === operator.id);
    if (!hasZoneAccess) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    if (order.paymentMethod !== "abonement") {
      return NextResponse.json({ error: "Аннулирование нал/безнал заказов доступно только владельцу" }, { status: 403 });
    }
  }

  const activeTickets = order.tickets.filter((t) => t.status === "active");
  if (activeTickets.length === 0) {
    return NextResponse.json({ error: "В заказе нет активных билетов для аннулирования" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const reason: string | null = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  const before = { tickets: activeTickets };
  const voidedIds = await prisma.$transaction(async (tx) => {
    for (const ticket of activeTickets) {
      await voidTicketInTx(
        tx,
        { id: ticket.id, orderId: ticket.orderId, priceSnapshot: ticket.priceSnapshot },
        {
          id: order.id,
          zoneId: order.zoneId,
          paymentMethod: order.paymentMethod,
          walletId: order.walletId,
          soldAt: order.soldAt,
        },
        opCtx
          ? { tenantId, pointId: opCtx.point.id, operatorId: opCtx.operator.id }
          : { tenantId, pointId: order.zone.pointId, userId: owner!.user.id }
      );
    }
    const after = await tx.ticket.findMany({ where: { id: { in: activeTickets.map((t) => t.id) } } });
    await tx.correctionLog.create({
      data: {
        entityType: "TicketOrder",
        entityId: order.id,
        correctedByUserId: opCtx ? null : owner!.user.id,
        correctedByOperatorId: opCtx ? opCtx.operator.id : null,
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: JSON.parse(JSON.stringify({ tickets: after })),
        comment: reason,
      },
    });
    return activeTickets.map((t) => t.id);
  });

  if (order.paymentMethod === "abonement" && order.walletId) {
    const totalRefunded = activeTickets.reduce((sum, t) => sum + Number(t.priceSnapshot), 0);
    await notifyWalletBalanceChange(tenantId, order.walletId, totalRefunded).catch(() => {});
  }

  return NextResponse.json({ voidedTicketIds: voidedIds });
}
