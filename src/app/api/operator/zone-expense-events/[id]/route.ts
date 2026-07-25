import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";

/**
 * Отменить случайную запись расхода — та же логика, что у
 * /api/operator/zone-return-events/[id]: только записи ТЕКУЩЕГО периода
 * зоны, уже учтённые прошлой сдачей итогов — не видны и не удалимы отсюда.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/operator/zone-expense-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  const event = await prisma.zoneExpenseEvent.findFirst({ where: { id, pointId: point.id } });
  if (!event) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(event.zoneId);
  if (boundary && event.createdAt <= boundary) {
    return NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 });
  }

  await prisma.zoneExpenseEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
