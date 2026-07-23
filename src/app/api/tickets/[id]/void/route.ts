import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { requireOperator } from "@/lib/require-operator";
import { voidTicketInTx } from "@/lib/tickets";
import { notifyWalletBalanceChange } from "@/lib/abonement";

/**
 * Аннулирование ОДНОГО билета — поштучно (docs/spec/10-tickets.md,
 * "АННУЛИРОВАНИЕ"). Погашенный билет не аннулируется (услуга оказана);
 * активный и истёкший — можно (оба — status="active", "истёк" не отдельное
 * хранимое значение).
 *
 * Владелец — без ограничений, любой способ оплаты. Оператор с доступом к
 * продаже билетов — ТОЛЬКО заказы, оплаченные балансом (запрос пользователя
 * 2026-07-21): у нал/безнал заказов уже пробит фискальный чек, программный
 * возврат кассой не отменяет его и рискует скрыть недостачу — та же причина,
 * по которой нал/безнал остаются только у Владельца. Балансовый возврат
 * физической кассы вообще не касается — чисто цифровая операция на кошельке
 * клиента.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/tickets/[id]/void">) {
  const opCtx = await requireOperator();
  const owner = opCtx ? null : await requireOwner();
  if (!opCtx && !owner) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      order: { include: { zone: { include: { point: true, operatorsWithAccess: { select: { id: true } } } } } },
    },
  });
  const tenantId = opCtx ? opCtx.point.tenantId : owner!.tenantId;
  if (!ticket || ticket.order.zone.point.tenantId !== tenantId) {
    return NextResponse.json({ error: "Билет не найден" }, { status: 404 });
  }

  if (opCtx) {
    const { operator, point } = opCtx;
    if (ticket.order.zone.pointId !== point.id) {
      return NextResponse.json({ error: "Билет не найден" }, { status: 404 });
    }
    if (!operator.ticketsAccess) {
      return NextResponse.json({ error: "Нет доступа к продаже билетов" }, { status: 403 });
    }
    const hasZoneAccess = operator.allZonesAccess || ticket.order.zone.operatorsWithAccess.some((o) => o.id === operator.id);
    if (!hasZoneAccess) {
      return NextResponse.json({ error: "Билет не найден" }, { status: 404 });
    }
    if (ticket.order.paymentMethod !== "abonement") {
      return NextResponse.json({ error: "Аннулирование нал/безнал заказов доступно только владельцу" }, { status: 403 });
    }
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
    const voided = await voidTicketInTx(
      tx,
      { id: ticket.id, orderId: ticket.orderId, priceSnapshot: ticket.priceSnapshot },
      {
        id: ticket.order.id,
        zoneId: ticket.order.zoneId,
        paymentMethod: ticket.order.paymentMethod,
        walletId: ticket.order.walletId,
        soldAt: ticket.order.soldAt,
      },
      opCtx
        ? { tenantId, pointId: opCtx.point.id, operatorId: opCtx.operator.id }
        : { tenantId, pointId: ticket.order.zone.pointId, userId: owner!.user.id }
    );
    if (!voided) return null;
    const result = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    await tx.correctionLog.create({
      data: {
        entityType: "Ticket",
        entityId: ticket.id,
        correctedByUserId: opCtx ? null : owner!.user.id,
        correctedByOperatorId: opCtx ? opCtx.operator.id : null,
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: JSON.parse(JSON.stringify(result)),
        comment: reason,
      },
    });
    return result;
  });

  if (!updated) {
    return NextResponse.json({ error: "Билет уже аннулирован" }, { status: 409 });
  }

  if (ticket.order.paymentMethod === "abonement" && ticket.order.walletId) {
    await notifyWalletBalanceChange(tenantId, ticket.order.walletId, Number(ticket.priceSnapshot)).catch(() => {});
  }

  return NextResponse.json({ id: updated.id, status: updated.status, voidedAt: updated.voidedAt });
}
