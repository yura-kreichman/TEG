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

  // Абонементная выручка (revenue_abonement) не привязана к ZoneSubmission —
  // признаётся сразу при трате, не при сдаче итогов (запрос пользователя
  // 2026-07-17), поэтому её нет в zs.cashAmount/mobileAmount выше. Для
  // фиксированного окна бизнес-дня (в отличие от цепочки сдач в
  // /api/reports/counters/day) достаточно просто просуммировать за bounds —
  // без per-submission "предыдущая сдача" привязки.
  const abonementOps = await prisma.moneyOperation.findMany({
    where: { type: "revenue_abonement", occurredAt: { gte: bounds.start, lt: bounds.end }, zone: { pointId } },
    select: { zoneId: true, amount: true, zone: { select: { name: true } } },
  });
  let abonementAmount = 0;
  const zoneAbonementById = new Map<string, number>();
  for (const op of abonementOps) {
    const amount = Number(op.amount);
    abonementAmount += amount;
    if (!op.zoneId) continue;
    zoneAbonementById.set(op.zoneId, (zoneAbonementById.get(op.zoneId) ?? 0) + amount);
    // Абонементом могли оплатить пуск в зоне, где сегодня ещё не было сдачи
    // итогов (список breakdown иначе строился бы только из ZoneSubmission) —
    // добавляем такую зону в разбивку сразу с нулевой "кассовой" выручкой.
    if (!zoneRevenueById.has(op.zoneId)) {
      zoneRevenueById.set(op.zoneId, { zoneName: op.zone?.name ?? "", revenue: 0 });
    }
  }

  // Продажа абонементов (планов) за день — реальные деньги, отдельно от
  // abonementAmount выше (та — трата с баланса, не продажа) — запрос
  // пользователя 2026-07-18: тот же разрыв, что закрыт в Итогах дня.
  const abonementSalesOps = await prisma.moneyOperation.findMany({
    where: { type: { in: ["abonement_topup", "abonement_topup_cashless"] }, occurredAt: { gte: bounds.start, lt: bounds.end }, pointId },
    select: { amount: true, type: true },
  });
  const abonementSold = abonementSalesOps.reduce(
    (acc, op) => {
      const amount = Number(op.amount);
      if (op.type === "abonement_topup_cashless") acc.mobile += amount;
      else acc.cash += amount;
      return acc;
    },
    { cash: 0, mobile: 0 }
  );

  // Премии/авансы, которые сотрудник взял САМ из кассы точки (запрос
  // пользователя 2026-07-17: "Премии+Авансы, которые взял Сотрудник") —
  // только performedByOperatorId (самообслуживание), НЕ владельческие
  // (performedByUserId — те выданы не из кассы точки, см. getPointCashBalance
  // в lib/zone-balance.ts). Справочная строка "откуда взялась" разница между
  // Итогом и Остатком — сама сумма и так уже учтена в Остатке ниже, тут не
  // прибавляется и не вычитается повторно.
  const bonusAdvanceOps = await prisma.moneyOperation.findMany({
    where: {
      type: { in: ["advance", "bonus_payout"] },
      pointId,
      performedByOperatorId: { not: null },
      occurredAt: { gte: bounds.start, lt: bounds.end },
    },
  });
  const bonusesAndAdvances = bonusAdvanceOps.reduce((sum, op) => sum + Math.abs(Number(op.amount)), 0);

  // getPointCashBalance — тот же расчёт остатка, что на "Остатки и
  // инкассации" (lib/zone-balance.ts): исключает revenue_cashless (безнал
  // физически не в кассе), abonement_topup_cashless и revenue_abonement (см.
  // affectsCashOnHand); advance/bonus_payout НЕ исключены — сотрудник
  // физически берёт их из кассы точки (если сам, после последней
  // инкассации), это отражено в Остатке ниже, комментарий тут раньше
  // ошибочно утверждал обратное.
  const cashOnHand = await getPointCashBalance(pointId);

  return {
    pointName: point.name,
    showPointName: pointCount > 1,
    businessDate: bounds.start,
    cashAmount: round2(cashAmount),
    mobileAmount: round2(mobileAmount),
    // Справочно — НЕ входит в cashAmount/mobileAmount/итог выше (уже получена
    // раньше, при пополнении абонемента, кассы точки сегодня не касается),
    // см. комментарий у abonementOps выше (запрос пользователя 2026-07-17:
    // "во всех отчётах и сводках должны быть правильные цифры").
    abonementAmount: round2(abonementAmount),
    abonementSold: { cash: round2(abonementSold.cash), mobile: round2(abonementSold.mobile) },
    expenses: round2(expenses),
    bonusesAndAdvances: round2(bonusesAndAdvances),
    zoneBreakdown: [...zoneRevenueById.entries()].map(([zoneId, z]) => ({
      zoneName: z.zoneName,
      revenue: round2(z.revenue),
      abonementAmount: round2(zoneAbonementById.get(zoneId) ?? 0),
    })),
    cashOnHand: round2(cashOnHand),
    forcedIncomplete,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
