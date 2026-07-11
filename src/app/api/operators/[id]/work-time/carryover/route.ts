import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";

// Перенос баланса — ручная запись владельца (стартовый баланс/корректировка),
// docs/spec/05-work-time.md, "БАЛАНС". НЕ операция денежного журнала — это не
// движение физической наличности, а корректировка того, сколько компания
// должна оператору. Может быть отрицательным.
export async function GET(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/carryover">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const entries = await prisma.operatorBalanceCarryover.findMany({
    where: { operatorId: id },
    orderBy: { createdAt: "desc" },
  });
  const total = entries.reduce((sum, e) => sum + Number(e.amount), 0);

  return NextResponse.json({
    total: Math.round(total * 100) / 100,
    entries: entries.map((e) => ({
      id: e.id,
      amount: Number(e.amount),
      comment: e.comment,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/carryover">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { amount, comment } = await request.json();
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber === 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  await prisma.operatorBalanceCarryover.create({
    data: {
      tenantId: owner.tenantId,
      operatorId: operator.id,
      amount: amountNumber,
      comment: typeof comment === "string" && comment.trim() ? comment.trim() : null,
      createdByUserId: owner.user.id,
    },
  });

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
