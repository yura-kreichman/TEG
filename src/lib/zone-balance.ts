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

// Физический остаток кассы точки в целом = сумма остатков её зон + операции,
// привязанные к точке целиком (аванс/премия — из общей кассы точки, не
// конкретной зоны). Источник денег на аванс/премию зависит от двух вещей
// (решение пользователя 2026-07-15/16, docs/spec/05-work-time.md):
// 1. Владелец вносит вручную из карточки сотрудника (performedByUserId) —
//    деньги не из кассы точки (уже забраны инкассацией, или переданы
//    отдельно, например переводом на карту) — кассы точки не касается,
//    остаток не уменьшает, вне зависимости от даты.
// 2. Сотрудник вводит сам (performedByOperatorId, без performedByUserId) —
//    физически берёт из кассы точки, но только если это произошло ПОСЛЕ
//    последней инкассации на точке: инкассация — момент, когда владелец
//    лично на точке пересчитывает и забирает деньги, поэтому всё, что было
//    до неё, считается закрытым/учтённым ею; актуален только "хвост" после
//    последней инкассации. Найдено и проверено на реальных данных
//    2026-07-16: аванс/премия оператора от предыдущего дня не должны
//    тянуть остаток в минус, если после них уже прошла инкассация.
// Используется и для отображения (docs/spec/05-work-time.md), и для
// валидации максимального самостоятельного аванса/премии сотрудника —
// единая цифра, на которую опираются оба места.
export async function getPointCashBalance(pointId: string): Promise<number> {
  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);

  const [zoneOps, pointOps] = await Promise.all([
    zoneIds.length ? prisma.moneyOperation.findMany({ where: { zoneId: { in: zoneIds } } }) : Promise.resolve([]),
    prisma.moneyOperation.findMany({ where: { pointId } }),
  ]);

  let total = 0;
  let lastCollectionAt: Date | null = null;
  for (const op of zoneOps) {
    if (op.type === "revenue_cashless") continue;
    total += Number(op.amount);
    if (op.type === "collection" && (!lastCollectionAt || op.occurredAt > lastCollectionAt)) {
      lastCollectionAt = op.occurredAt;
    }
  }
  for (const op of pointOps) {
    if (op.type === "revenue_cashless") continue;
    if (op.type === "advance" || op.type === "bonus_payout") {
      if (op.performedByUserId) continue;
      if (lastCollectionAt && op.occurredAt <= lastCollectionAt) continue;
    }
    total += Number(op.amount);
  }
  return total;
}
