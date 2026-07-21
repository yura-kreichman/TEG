import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { voidTicketInTx } from "@/lib/tickets";

/**
 * Аннулирование ОДНОГО билета — только владелец, поштучно
 * (docs/spec/10-tickets.md, "АННУЛИРОВАНИЕ"). Погашенный билет не
 * аннулируется (услуга оказана); активный и истёкший — можно (оба —
 * status="active", "истёк" не отдельное хранимое значение).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/tickets/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { order: { include: { zone: { include: { point: true } } } } },
  });
  if (!ticket || ticket.order.zone.point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Билет не найден" }, { status: 404 });
  }
  if (ticket.status === "redeemed") {
    return NextResponse.json({ error: "Погашенный билет нельзя аннулировать" }, { status: 400 });
  }
  if (ticket.status === "voided") {
    return NextResponse.json({ error: "Билет уже аннулирован" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const reason: string | null = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  const before = { ...ticket };
  const updated = await prisma.$transaction(async (tx) => {
    await voidTicketInTx(
      tx,
      { id: ticket.id, orderId: ticket.orderId, priceSnapshot: ticket.priceSnapshot },
      {
        id: ticket.order.id,
        zoneId: ticket.order.zoneId,
        paymentMethod: ticket.order.paymentMethod,
        walletId: ticket.order.walletId,
        soldAt: ticket.order.soldAt,
      },
      { tenantId: owner.tenantId, pointId: ticket.order.zone.pointId, userId: owner.user.id }
    );
    const result = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    await tx.correctionLog.create({
      data: {
        entityType: "Ticket",
        entityId: ticket.id,
        correctedByUserId: owner.user.id,
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: JSON.parse(JSON.stringify(result)),
        comment: reason,
      },
    });
    return result;
  });

  return NextResponse.json({ id: updated.id, status: updated.status, voidedAt: updated.voidedAt });
}
