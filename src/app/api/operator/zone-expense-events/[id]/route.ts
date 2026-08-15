import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

/**
 * Отменить случайную запись расхода — та же логика, что у
 * /api/operator/zone-return-events/[id]: только записи ТЕКУЩЕГО периода
 * зоны, уже учтённые сдачей итогов — не видны и не удалимы отсюда.
 *
 * "Текущий период" с 2026-08-15 — это resultsSubmissionId = null у самой
 * операции (см. шапку соседнего route.ts): признак точнее прежнего сравнения
 * времени с границей последней сдачи — та отвечала "когда была сдача", а не
 * "вошла ли в неё ИМЕННО эта строка". Расход, уже привязанный к сдаче,
 * правит и удаляет только Владелец, в реестре расходов.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/operator/zone-expense-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  // zone.pointId вместо прежнего собственного pointId записи — у операции
  // журнала точка выводится через зону (CHECK-констрейнт MoneyOperation
  // разрешает заполнить только одно из zoneId/pointId).
  const operation = await prisma.moneyOperation.findFirst({
    where: { id, type: "expense", zone: { pointId: point.id } },
    select: { id: true, resultsSubmissionId: true },
  });
  if (!operation) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }
  if (operation.resultsSubmissionId) {
    return NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 });
  }

  await prisma.moneyOperation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
