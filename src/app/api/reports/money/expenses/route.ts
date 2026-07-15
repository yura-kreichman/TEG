import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Тенант-wide реестр расходов (ExpenseEntry) за месяц — список отдельных
// записей с категорией и комментарием (запрос пользователя 2026-07-14),
// в отличие от бизнес-карточки "Деньги", которая показывает только сумму.
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

  const entries = await prisma.expenseEntry.findMany({
    where: {
      zoneSubmission: { zone: { point: { tenantId: owner.tenantId } } },
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    include: { category: true, zoneSubmission: { include: { zone: { include: { point: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  const expenses = entries.map((e) => ({
    id: e.id,
    occurredAt: e.createdAt.toISOString(),
    zoneName: e.zoneSubmission.zone.name,
    pointName: e.zoneSubmission.zone.point.name,
    categoryName: e.category?.name ?? null,
    comment: e.comment,
    amount: Math.abs(Number(e.amount)),
  }));

  // Название точки в строке имеет смысл, только если точек больше одной
  // (запрос пользователя 2026-07-14 — и так ясно, если она одна).
  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });

  return NextResponse.json({ expenses, showPointName: pointCount > 1 });
}
