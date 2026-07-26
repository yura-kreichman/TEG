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
  //
  // Advisory-лок по operatorId (аудит 2026-07-26) — раньше проверка баланса и
  // создание MoneyOperation были обычным read-then-write без блокировки, а
  // сама форма на карточке оператора не защищена от двойного клика/тапа:
  // два почти одновременных запроса читали один и тот же "к выдаче" и оба
  // проходили проверку — выплата реально задваивалась. Тот же приём, что уже
  // применён к кассе точки в operator/work-time/shifts/[id]/route.ts.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
    const balance = await calcOperatorBalance(operator.id, undefined, tx);
    if (!operator.overdraftAllowed && amountNumber > balance.toPayOut) {
      return { ok: false as const, toPayOut: balance.toPayOut };
    }
    await tx.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId: point.id,
        type: "advance",
        amount: -amountNumber,
        performedByUserId: owner.user.id,
        beneficiaryOperatorId: operator.id,
      },
    });
    return { ok: true as const };
  });
  if (!result.ok) {
    const locale = await resolveLocale();
    return NextResponse.json(
      { error: `Аванс превышает доступный баланс к выдаче (${formatMoney(result.toPayOut, locale)})` },
      { status: 400 }
    );
  }

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
