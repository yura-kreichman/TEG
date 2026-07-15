import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Тенант-wide реестр инкассаций (type=collection) за месяц для компактного
// списка на странице Деньги — замена календарю "Выручка по дням".
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
    where: { tenantId: owner.tenantId, type: "collection", occurredAt: { gte: monthStart, lt: monthEnd } },
    include: { zone: { include: { point: true } } },
    orderBy: { occurredAt: "desc" },
  });

  // "collection" всегда зонная операция (только advance/bonus_payout из
  // 05-work-time.md — точечные) — фильтр защищает только от гипотетических
  // будущих багов, не от реального пути в приложении.
  const collections = operations
    .filter((op) => op.zone !== null)
    .map((op) => ({
      id: op.id,
      occurredAt: op.occurredAt.toISOString(),
      zoneName: op.zone!.name,
      pointName: op.zone!.point.name,
      amount: Math.abs(Number(op.amount)),
    }));

  // Название точки в строке имеет смысл, только если точек больше одной
  // (запрос пользователя 2026-07-14 — и так ясно, если она одна).
  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });

  return NextResponse.json({ collections, showPointName: pointCount > 1 });
}
