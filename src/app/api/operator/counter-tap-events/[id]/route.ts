import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";

/**
 * Отменить случайный тап — та же логика, что у /api/operator/zone-return-
 * events/[id]: обычная отмена опечатки в моменте ("раз не внёс — проехали"
 * при сдаче итогов), не ретроактивная правка. Только события ТЕКУЩЕГО
 * периода зоны.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/operator/counter-tap-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  const event = await prisma.counterTapEvent.findFirst({ where: { id, pointId: point.id } });
  if (!event) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(event.zoneId);
  if (boundary && event.createdAt <= boundary) {
    return NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 });
  }

  await prisma.counterTapEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/**
 * Пометить/снять конкретный тап как "Возврат/тест" (запрос пользователя
 * 2026-07-25: "у конкретных активов был выбран конкретный метод оплаты" —
 * возврат должен исключать ИМЕННО свой способ оплаты из подсказки кассы, не
 * размазываться пропорционально между наличными/безналом всей зоны). Тот же
 * принцип, что Launch.voidedAt (docs/spec/04-game-room.md): тап остаётся в
 * базе и по-прежнему увеличивает показание (реальный счётчик тоже тикнул бы
 * на тестовом заезде), но выручка/подсказка его больше не считают. В отличие
 * от DELETE — обратимо (снять пометку так же легко, как поставить), это не
 * "убрать ошибку", а "пометить как не-выручку".
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/operator/counter-tap-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (typeof body?.voided !== "boolean") {
    return NextResponse.json({ error: "Не указано значение voided" }, { status: 400 });
  }

  const event = await prisma.counterTapEvent.findFirst({ where: { id, pointId: point.id } });
  if (!event) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(event.zoneId);
  if (boundary && event.createdAt <= boundary) {
    return NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 });
  }

  const updated = await prisma.counterTapEvent.update({
    where: { id },
    data: { voidedAt: body.voided ? new Date() : null },
  });
  return NextResponse.json({ id: updated.id, voidedAt: updated.voidedAt });
}
