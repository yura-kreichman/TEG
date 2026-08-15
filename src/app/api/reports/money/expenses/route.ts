import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantDayContext } from "@/lib/tenant-day";
import { requireOwner } from "@/lib/require-owner";
import { dayBoundsUtc } from "@/lib/business-day";

// Тенант-wide реестр расходов за месяц — список отдельных записей с
// категорией и комментарием (запрос пользователя 2026-07-14), в отличие от
// бизнес-карточки "Деньги", которая показывает только сумму.
//
// Источник — сам журнал (MoneyOperation type="expense"), а не производная
// ExpenseEntry, привязанная к сдаче итогов (переведено 2026-08-15). Прежний
// источник показывал ТОЛЬКО расходы, успевшие войти в сдачу: внесённый после
// сдачи расход не существовал для владельца нигде — ни здесь, ни в прибыли,
// ни в сводке — до следующей сдачи, которая ставила его чужой датой. Реальный
// случай в этот день: расход в 22:46 при сдаче в 22:22.
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

  // Часовой пояс тенанта, не сырой UTC сервера (аудит 2026-07-24, тот же
  // класс бага, что и у /api/reports/counters/day — см. комментарий у
  // dayBoundsUtc в lib/business-day.ts).
  const { timezone, boundary } = await getTenantDayContext(owner.tenantId);
  const monthStart = dayBoundsUtc(year, month, 1, timezone, boundary).start;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const monthEnd = dayBoundsUtc(nextMonth.year, nextMonth.month, 1, timezone, boundary).start;

  const operations = await prisma.moneyOperation.findMany({
    where: {
      tenantId: owner.tenantId,
      type: "expense",
      occurredAt: { gte: monthStart, lt: monthEnd },
    },
    include: { expenseCategory: true, zone: { include: { point: true } } },
    orderBy: { occurredAt: "desc" },
  });

  const expenses = operations.map((op) => ({
    id: op.id,
    occurredAt: op.occurredAt.toISOString(),
    zoneId: op.zoneId,
    zoneName: op.zone?.name ?? "",
    pointName: op.zone?.point.name ?? "",
    categoryId: op.expenseCategoryId,
    categoryName: op.expenseCategory?.name ?? null,
    comment: op.comment,
    amount: Math.abs(Number(op.amount)),
  }));

  // Название точки в строке имеет смысл, только если точек больше одной
  // (запрос пользователя 2026-07-14 — и так ясно, если она одна).
  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });

  return NextResponse.json({ expenses, showPointName: pointCount > 1 });
}
