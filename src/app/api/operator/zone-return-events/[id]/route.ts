import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";

/**
 * Отменить случайную запись "Возврат/тест" — не "ретроактивная правка сдачи
 * итогов" (та запрещена решением пользователя 2026-07-24: "раз не внёс, то
 * проехали"), а обычная отмена опечатки в моменте, тот же принцип, что и
 * "минус" у корзины Товаров/Билетов. Только события ТЕКУЩЕГО периода зоны —
 * запись, уже попавшая в прошлую сдачу итогов, отсюда не видна и не
 * удалима (проверка ниже).
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/operator/zone-return-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  const event = await prisma.zoneReturnEvent.findFirst({ where: { id, pointId: point.id } });
  if (!event) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(event.zoneId);
  if (boundary && event.createdAt <= boundary) {
    return NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 });
  }

  await prisma.zoneReturnEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
