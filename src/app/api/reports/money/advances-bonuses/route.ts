import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Тенант-wide реестр авансов/премий (docs/spec/05-work-time.md) за месяц —
// без него эти операции нигде не видны на странице Деньги, только влияют на
// "Расходы" бизнес-карточки. Точечные операции (pointId), не привязаны к зоне.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month")); // 1-12

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const operations = await prisma.moneyOperation.findMany({
    where: {
      tenantId: owner.tenantId,
      type: { in: ["advance", "bonus_payout"] },
      occurredAt: { gte: monthStart, lt: monthEnd },
    },
    include: { point: true, beneficiaryOperator: true },
    orderBy: { occurredAt: "desc" },
  });

  const entries = operations
    .filter((op) => op.point !== null)
    .map((op) => ({
      id: op.id,
      occurredAt: op.occurredAt.toISOString(),
      type: op.type as "advance" | "bonus_payout",
      amount: Math.abs(Number(op.amount)),
      pointName: op.point!.name,
      operatorName: op.beneficiaryOperator?.name ?? null,
    }));

  return NextResponse.json({ entries });
}
