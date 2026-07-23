import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { dayBoundsUtc, localDateParts } from "@/lib/business-day";

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

  // Часовой пояс тенанта, не сырой UTC сервера (аудит 2026-07-24: тот же
  // класс бага, что уже чинили для /api/reports/money — календарь мог
  // подсвечивать сумму на СОСЕДНЕМ числе относительно "Итогов дня"/
  // "Отчётов" для операций около полуночи по месту).
  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const timezone = tenant?.timezone ?? "UTC";
  const monthStart = dayBoundsUtc(year, month, 1, timezone).start;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const monthEnd = dayBoundsUtc(nextMonth.year, nextMonth.month, 1, timezone).start;

  const operations = await prisma.moneyOperation.findMany({
    where: {
      tenantId: owner.tenantId,
      // Товарная выручка (docs/spec/09-goods.md: "Товары — не отдельный
      // бизнес") — та же выручка, что /api/reports/money и /api/reports/
      // home-summary уже намеренно вливают в общий итог; календарь Денег был
      // единственным местом, которое их не учитывало (аудит 2026-07-24).
      type: {
        in: [
          "revenue",
          "revenue_cashless",
          "revenue_abonement",
          "goods_revenue",
          "goods_revenue_cashless",
          "goods_revenue_abonement",
        ],
      },
      occurredAt: { gte: monthStart, lt: monthEnd },
      ...(pointIdParam ? { OR: [{ zone: { pointId: pointIdParam } }, { pointId: pointIdParam }] } : {}),
    },
    select: { amount: true, occurredAt: true },
  });

  const dayRevenue: Record<string, number> = {};
  for (const op of operations) {
    // Календарный день ПО МЕСТУ (тенант-таймзона), не op.occurredAt.toISOString()
    // (сырой UTC — тот же баг, что и у самих границ месяца выше).
    const { year: y, month: m, day: d } = localDateParts(op.occurredAt, timezone);
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    dayRevenue[key] = (dayRevenue[key] ?? 0) + Number(op.amount);
  }
  for (const key of Object.keys(dayRevenue)) {
    dayRevenue[key] = Math.round(dayRevenue[key] * 100) / 100;
  }

  return NextResponse.json({ dayRevenue });
}
