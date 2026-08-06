import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { businessDayOf } from "@/lib/business-day";

// Дата последней сдачи (по выручке в журнале Денег) — для дефолта на экране
// /money (запрос пользователя 2026-07-14: по умолчанию должен открываться
// День последней сдачи, а не сегодняшний пустой день, если сегодня ещё
// ничего не сдавали).
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const [op, tenant] = await Promise.all([
    prisma.moneyOperation.findFirst({
      where: {
        tenantId: owner.tenantId,
        // Абонементы — по пополнению, не по трате (пересмотрено 2026-07-25,
        // см. reports/money/route.ts) — та же выручка, что считает /money.
        type: { in: ["revenue", "revenue_cashless", "abonement_topup", "abonement_topup_cashless"] },
      },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
    prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true, businessDayBoundary: true } }),
  ]);

  // Местная календарная дата тенанта, не сырой UTC (аудит 2026-07-24, тот же
  // класс бага, что и у counters/last-submission-date).
  if (!op) return NextResponse.json({ date: null });
  const { year, month, day } = businessDayOf(
    op.occurredAt,
    tenant?.timezone ?? "UTC",
    tenant?.businessDayBoundary ?? "00:00"
  );
  return NextResponse.json({ date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
}
