import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { dayBoundsUtc } from "@/lib/business-day";

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

  // Часовой пояс тенанта, не сырой UTC сервера (аудит 2026-07-24, тот же
  // класс бага, что и у /api/reports/counters/day — см. комментарий у
  // dayBoundsUtc в lib/business-day.ts).
  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const timezone = tenant?.timezone ?? "UTC";
  const monthStart = dayBoundsUtc(year, month, 1, timezone).start;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const monthEnd = dayBoundsUtc(nextMonth.year, nextMonth.month, 1, timezone).start;

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

  // Название точки в строке имеет смысл, только если точек больше одной
  // (запрос пользователя 2026-07-14 — и так ясно, если она одна).
  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });

  return NextResponse.json({ entries, showPointName: pointCount > 1 });
}
