import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Тенант-wide (в отличие от /api/reports/counters/calendar, который
// точечный) — суммы выручки по дням месяца для календаря на странице Деньги.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month")); // 1-12
  const pointIdParam = searchParams.get("pointId");

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const operations = await prisma.moneyOperation.findMany({
    where: {
      tenantId: owner.tenantId,
      type: { in: ["revenue", "revenue_cashless", "revenue_abonement"] },
      occurredAt: { gte: monthStart, lt: monthEnd },
      ...(pointIdParam ? { zone: { pointId: pointIdParam } } : {}),
    },
    select: { amount: true, occurredAt: true },
  });

  const dayRevenue: Record<string, number> = {};
  for (const op of operations) {
    const key = op.occurredAt.toISOString().slice(0, 10);
    dayRevenue[key] = (dayRevenue[key] ?? 0) + Number(op.amount);
  }
  for (const key of Object.keys(dayRevenue)) {
    dayRevenue[key] = Math.round(dayRevenue[key] * 100) / 100;
  }

  return NextResponse.json({ dayRevenue });
}
