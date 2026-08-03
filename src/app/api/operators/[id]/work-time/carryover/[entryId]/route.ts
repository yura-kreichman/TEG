import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";

// Удаление записи переноса (обратная связь пользователя 2026-08-02).
// Раньше перенос можно было только создать: в API были GET и POST, и владелец,
// однажды внёсший стартовый остаток, оставался с ним навсегда — даже если
// ошибся в сумме или внёс запись пробно. Обычные операции журнала (аванс,
// премия) правятся из карточки сотрудника, и отсутствие того же у переноса
// было просто пробелом, а не осознанным решением.
//
// Это НЕ операция денежного журнала (см. GET/POST рядом) — физических денег
// перенос не двигал, поэтому и удаление ничего не возвращает в кассу: просто
// уменьшает долг компании перед сотрудником на ту же сумму.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/carryover/[entryId]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id, entryId } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  // Сверяем и operatorId, и tenantId: id записи приходит из браузера, и без
  // этой проверки владелец одного тенанта мог бы удалить перенос чужого
  // сотрудника, зная только идентификатор.
  const entry = await prisma.operatorBalanceCarryover.findFirst({
    where: { id: entryId, operatorId: operator.id, tenantId: owner.tenantId },
  });
  if (!entry) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  await prisma.operatorBalanceCarryover.delete({ where: { id: entry.id } });

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
