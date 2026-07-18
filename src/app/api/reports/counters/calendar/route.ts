import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Which calendar days (within one month) had at least one "сдача итогов" for
// a given point — drives the calendar highlighting in /money/readings.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month")); // 1-12

  if (!pointId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const [submissions, abonementSales] = await Promise.all([
    prisma.resultsSubmission.findMany({
      where: { pointId, submittedAt: { gte: monthStart, lt: monthEnd } },
      select: { submittedAt: true },
    }),
    // Дни, где были только продажи абонементов, без единой Сдачи итогов —
    // тоже должны быть кликабельны (запрос пользователя 2026-07-18).
    prisma.moneyOperation.findMany({
      where: {
        pointId,
        type: { in: ["abonement_topup", "abonement_topup_cashless"] },
        occurredAt: { gte: monthStart, lt: monthEnd },
      },
      select: { occurredAt: true },
    }),
  ]);

  const activeDates = [
    ...new Set([
      ...submissions.map((s) => s.submittedAt.toISOString().slice(0, 10)),
      ...abonementSales.map((op) => op.occurredAt.toISOString().slice(0, 10)),
    ]),
  ].sort();

  return NextResponse.json({ activeDates });
}
