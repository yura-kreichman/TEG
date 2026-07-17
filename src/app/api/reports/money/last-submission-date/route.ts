import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Дата последней сдачи (по выручке в журнале Денег) — для дефолта на экране
// /money (запрос пользователя 2026-07-14: по умолчанию должен открываться
// День последней сдачи, а не сегодняшний пустой день, если сегодня ещё
// ничего не сдавали).
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const op = await prisma.moneyOperation.findFirst({
    where: { tenantId: owner.tenantId, type: { in: ["revenue", "revenue_cashless", "revenue_abonement"] } },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });

  return NextResponse.json({ date: op ? op.occurredAt.toISOString().slice(0, 10) : null });
}
