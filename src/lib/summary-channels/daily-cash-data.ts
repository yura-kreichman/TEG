import { prisma } from "@/lib/prisma";
import { getPointCashBalance } from "@/lib/zone-balance";
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
 * Расходы — только MoneyOperation type=expense, тот же состав, что "Бизнес:
 * расходы и прибыль" в /api/reports/money (запрос пользователя 2026-07-14:
 * авансы/премии — не расход бизнеса, а выплата уже заработанного персоналу,
 * отдельно видны в /money/advances-bonuses). Раньше сюда ошибочно
 * подмешивались advance/bonus_payout — реальный баг, найден пользователем
 * 2026-07-15 по живой Telegram-сводке ("Расходы у нас это совсем другое").
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

  const pointCount = await prisma.point.count({ where: { tenantId: point.tenantId } });

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
      OR: [{ zone: { pointId } }, { pointId }],
    },
  });
  const expenses = expenseOps.reduce((sum, op) => sum + Math.abs(Number(op.amount)), 0);

  // getPointCashBalance — тот же расчёт остатка, что на "Остатки и
  // инкассации" (lib/zone-balance.ts): исключает revenue_cashless (безнал
  // физически не в кассе) и bonus_payout (премия выдаётся из уже
  // инкассированных денег, кассы точки не касается).
  const cashOnHand = await getPointCashBalance(pointId);

  return {
    pointName: point.name,
    showPointName: pointCount > 1,
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
