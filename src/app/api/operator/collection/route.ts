import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Инкассация: оператор вводит сумму, переданную владельцу; касса уменьшается.
// Подтверждение владельцем не требуется (docs/spec/02-money.md).
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { zoneId, amount } = await request.json();
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, include: { point: true } });
  if (!zone || zone.point.tenantId !== ctx.point.tenantId) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  await prisma.moneyOperation.create({
    data: {
      tenantId: ctx.point.tenantId,
      zoneId,
      type: "collection",
      amount: -Math.abs(amountNumber),
      performedByOperatorId: ctx.operator.id,
    },
  });

  return NextResponse.json({ ok: true });
}
