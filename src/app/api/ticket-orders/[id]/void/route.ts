import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { voidTicketInTx } from "@/lib/tickets";

/**
 * "Аннулировать заказ" — кнопка-удобство, аннулирует РАЗОМ все живые
 * (status="active") билеты заказа (docs/spec/10-tickets.md, "АННУЛИРОВАНИЕ":
 * "«Аннулировать заказ» = все живые билеты разом"). Один CorrectionLog на
 * весь заказ (entityType="TicketOrder"), не по записи на билет — это
 * действие пользователя одно, а не N независимых.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/ticket-orders/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const order = await prisma.ticketOrder.findUnique({
    where: { id },
    include: { zone: { include: { point: true } }, tickets: true },
  });
  if (!order || order.zone.point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
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
        { tenantId: owner.tenantId, pointId: order.zone.pointId, userId: owner.user.id }
      );
    }
    const after = await tx.ticket.findMany({ where: { id: { in: activeTickets.map((t) => t.id) } } });
    await tx.correctionLog.create({
      data: {
        entityType: "TicketOrder",
        entityId: order.id,
        correctedByUserId: owner.user.id,
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: JSON.parse(JSON.stringify({ tickets: after })),
        comment: reason,
      },
    });
    return activeTickets.map((t) => t.id);
  });

  return NextResponse.json({ voidedTicketIds: voidedIds });
}
