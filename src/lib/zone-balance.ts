import { prisma } from "@/lib/prisma";

// Текущий остаток кассы каждой зоны — весь журнал MoneyOperation, без
// периода (docs/spec/02-money.md: "остаток зоны = сумма журнала"), кроме
// revenue_cashless (безнал не лежит в кассе физически). Тот же расчёт, что в
// /api/reports/money — общий для owner- и operator-инкассации, чтобы
// пропорциональная разбивка "общей" инкассации всегда опиралась на одни и те
// же цифры, что видны на экране "Остатки по зонам".
export async function getZoneBalances(zoneIds: string[]): Promise<Map<string, number>> {
  if (zoneIds.length === 0) return new Map();

  const operations = await prisma.moneyOperation.findMany({
    where: { zoneId: { in: zoneIds } },
  });

  const balanceByZone = new Map<string, number>();
  for (const op of operations) {
    if (op.type === "revenue_cashless" || !op.zoneId) continue;
    balanceByZone.set(op.zoneId, (balanceByZone.get(op.zoneId) ?? 0) + Number(op.amount));
  }
  return balanceByZone;
}
