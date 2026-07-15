import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";

// Ручной аванс из карточки оператора (docs/spec/05-work-time.md,
// "ИНТЕРФЕЙС ВЛАДЕЛЬЦА") — не привязан к смене (shiftId остаётся null).
// Владелец не залогинен на устройство точки, поэтому кассу (pointId)
// указывает явно в запросе.
export async function POST(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/advance">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { amount, pointId } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }

  // Владелец вносит аванс вручную — деньги не из кассы точки (решение
  // пользователя 2026-07-15: уже забраны инкассацией, или переданы отдельно,
  // например переводом на карту), поэтому кассу точки эта операция не
  // затрагивает и не проверяется по её остатку. Проверка — как раньше, по
  // личному балансу сотрудника "к выдаче" + овердрафт. У самого сотрудника
  // (self-service в PWA) наоборот: без овердрафта, но по остатку кассы точки —
  // см. /api/operator/work-time/check-out и .../shifts.
  const balance = await calcOperatorBalance(operator.id);
  if (!operator.overdraftAllowed && amountNumber > balance.toPayOut) {
    const locale = await resolveLocale();
    return NextResponse.json(
      { error: `Аванс превышает доступный баланс к выдаче (${formatMoney(balance.toPayOut, locale)})` },
      { status: 400 }
    );
  }

  await prisma.moneyOperation.create({
    data: {
      tenantId: owner.tenantId,
      pointId: point.id,
      type: "advance",
      amount: -amountNumber,
      performedByUserId: owner.user.id,
      beneficiaryOperatorId: operator.id,
    },
  });

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
