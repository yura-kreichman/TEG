import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

class LaunchNotLockedError extends Error {}

// Возврат зафиксированного (см. /api/launches/[id]/lock), но ещё НЕ
// оплаченного пуска обратно в идущий (запрос пользователя 2026-07-27:
// "передумал уходить, таймер должен продолжить считать") — единственный
// путь назад из промежуточного состояния "остановлен, ждёт способ оплаты"
// в isOpen:true. Явное действие оператора (иконка ▶ в шторке), не
// срабатывает само при простом закрытии шторки — та просто закрывается,
// пуск остаётся ждать оплату и шторка откроется для него же при следующем
// заходе (решение пользователя того же дня).
export async function POST(_request: Request, ctx: RouteContext<"/api/launches/[id]/resume">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id } = await ctx.params;

  const launch = await prisma.launch.findUnique({ where: { id }, select: { zoneId: true, zone: { select: { pointId: true } } } });
  if (!launch || launch.zone.pointId !== point.id) {
    return NextResponse.json({ error: "Пуск не найден" }, { status: 404 });
  }
  if (!operator.allZonesAccess) {
    const hasAccess = await prisma.zone.findFirst({
      where: { id: launch.zoneId, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (!hasAccess) {
      return NextResponse.json({ error: "Нет доступа к этой зоне" }, { status: 403 });
    }
  }

  try {
    // CAS — где paymentMethod ещё null (только зафиксированный, не
    // оплаченный) — уже оплаченный пуск "возобновить" нельзя, это стёрло бы
    // реальную завершённую операцию.
    await prisma.$transaction(async (tx) => {
      const result = await tx.launch.updateMany({
        where: { id, isOpen: false, paymentMethod: null },
        data: { isOpen: true, endedAt: null, amount: null, endedByOperatorId: null },
      });
      if (result.count === 0) throw new LaunchNotLockedError();
    });
  } catch (err) {
    if (err instanceof LaunchNotLockedError) {
      return NextResponse.json({ error: "Пуск уже оплачен или ещё идёт" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
