import { prisma } from "@/lib/prisma";
import type { DailyCashSummaryData } from "./types";

/** Есть ли хоть одна сдача итогов на точке в границах бизнес-дня. */
export async function hasActivityInBounds(pointId: string, bounds: { start: Date; end: Date }): Promise<boolean> {
  const count = await prisma.resultsSubmission.count({
    where: { pointId, submittedAt: { gte: bounds.start, lt: bounds.end } },
  });
  return count > 0;
}

/**
 * Собирает структурированные данные "Кассы за день" для точки за бизнес-день.
 * Наличные/безнал — из ZoneSubmission (единственное место, где вообще
 * хранится безнал, docs/spec/02-money.md — в журнале денег его нет).
 * Расходы — из MoneyOperation type=expense (единый источник правды по деньгам).
 * Остаток на точке — ВЕСЬ журнал, без периода (как /api/reports/money), это
 * текущее состояние кассы, а не показатель за день.
 */
export async function buildDailyCashSummaryData(
  pointId: string,
  bounds: { start: Date; end: Date },
  forcedIncomplete: boolean
): Promise<DailyCashSummaryData | null> {
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point) return null;

  const submissions = await prisma.resultsSubmission.findMany({
    where: { pointId, submittedAt: { gte: bounds.start, lt: bounds.end } },
    include: { zoneSubmissions: { include: { zone: true } } },
  });

  let cashAmount = 0;
  let mobileAmount = 0;
  const zoneRevenueById = new Map<string, { zoneName: string; revenue: number }>();

  for (const submission of submissions) {
    for (const zs of submission.zoneSubmissions) {
      const cash = Number(zs.cashAmount);
      const mobile = Number(zs.mobileAmount);
      cashAmount += cash;
      mobileAmount += mobile;

      const entry = zoneRevenueById.get(zs.zoneId) ?? { zoneName: zs.zone.name, revenue: 0 };
      entry.revenue += cash + mobile;
      zoneRevenueById.set(zs.zoneId, entry);
    }
  }

  const expenseOps = await prisma.moneyOperation.findMany({
    where: {
      type: "expense",
      occurredAt: { gte: bounds.start, lt: bounds.end },
      zone: { pointId },
    },
  });
  const expenses = expenseOps.reduce((sum, op) => sum + Math.abs(Number(op.amount)), 0);

  const [zoneBalanceAgg, pointBalanceAgg] = await Promise.all([
    prisma.moneyOperation.aggregate({ where: { zone: { pointId } }, _sum: { amount: true } }),
    prisma.moneyOperation.aggregate({ where: { pointId }, _sum: { amount: true } }),
  ]);
  const cashOnHand =
    Number(zoneBalanceAgg._sum.amount ?? 0) + Number(pointBalanceAgg._sum.amount ?? 0);

  return {
    pointName: point.name,
    businessDate: bounds.start,
    cashAmount: round2(cashAmount),
    mobileAmount: round2(mobileAmount),
    expenses: round2(expenses),
    zoneBreakdown: [...zoneRevenueById.values()].map((z) => ({ zoneName: z.zoneName, revenue: round2(z.revenue) })),
    cashOnHand: round2(cashOnHand),
    forcedIncomplete,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
