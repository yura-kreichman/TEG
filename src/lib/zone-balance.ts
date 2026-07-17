import { prisma } from "@/lib/prisma";
import { distributeCollectionWhole } from "@/lib/collection-split";

// Типы операций, которые НЕ лежат физически в кассе (docs/spec/02-money.md) —
// revenue_cashless (безнал), а с абонементами (запрос пользователя
// 2026-07-17) ещё два: abonement_topup_cashless (пополнение безналом — та же
// причина, что у revenue_cashless) и revenue_abonement (трата с баланса —
// реальных денег в этот момент не приходит, они пришли раньше, при
// пополнении). abonement_topup (пополнение НАЛИЧНЫМИ) в списке нет
// специально — это реальные деньги в кассе точки прямо сейчас, ровно как
// revenue.
const CASH_EXCLUDED_TYPES = new Set(["revenue_cashless", "abonement_topup_cashless", "revenue_abonement"]);

export function affectsCashOnHand(type: string): boolean {
  return !CASH_EXCLUDED_TYPES.has(type);
}

// Текущий остаток кассы каждой зоны — весь журнал MoneyOperation, без
// периода (docs/spec/02-money.md: "остаток зоны = сумма журнала"), кроме
// типов из CASH_EXCLUDED_TYPES выше. Тот же расчёт, что в /api/reports/money —
// общий для owner- и operator-инкассации, чтобы пропорциональная разбивка
// "общей" инкассации всегда опиралась на одни и те же цифры, что видны на
// экране "Остатки по зонам".
export async function getZoneBalances(zoneIds: string[]): Promise<Map<string, number>> {
  if (zoneIds.length === 0) return new Map();

  const operations = await prisma.moneyOperation.findMany({
    where: { zoneId: { in: zoneIds } },
  });

  const balanceByZone = new Map<string, number>();
  for (const op of operations) {
    if (!affectsCashOnHand(op.type) || !op.zoneId) continue;
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
    if (!affectsCashOnHand(op.type)) continue;
    total += Number(op.amount);
    if (op.type === "collection" && (!lastCollectionAt || op.occurredAt > lastCollectionAt)) {
      lastCollectionAt = op.occurredAt;
    }
  }
  for (const op of pointOps) {
    if (!affectsCashOnHand(op.type)) continue;
    if (op.type === "advance" || op.type === "bonus_payout") {
      if (op.performedByUserId) continue;
      if (lastCollectionAt && op.occurredAt <= lastCollectionAt) continue;
    }
    total += Number(op.amount);
  }
  return total;
}

// "Пул" — деньги, которые сотрудник уже физически забрал с точки (аванс/
// премия после последней инкассации, см. getPointCashBalance выше), но
// которые ещё не списаны из журнала конкретных зон (он не знает, из какой
// зоны физически взяли). Найдено на реальных данных 2026-07-16: если просто
// показывать эту сумму вычтенной только на экране (как раньше), а инкассация
// продолжает списывать с зон полную "сырую" сумму — при следующей инкассации
// реально спишется меньше, чем нужно, и разница зависает в журнале зон
// навсегда (инкассация "поглощает" аванс/премию как понятие для
// getPointCashBalance, но не как цифру для самих зон). Поэтому любая
// инкассация (по зоне или общая, владельцем или оператором) должна
// довзыскивать этот пул одновременно с введённой суммой — см. использование
// в /api/*/collection*.
async function computeZonePool(pointId: string): Promise<{ zoneIds: string[]; weights: number[]; deficit: number }> {
  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);
  const [balances, pointTotal] = await Promise.all([getZoneBalances(zoneIds), getPointCashBalance(pointId)]);
  const weights = zoneIds.map((id) => balances.get(id) ?? 0);
  const zonesRawSum = weights.reduce((a, b) => a + b, 0);
  const deficit = Math.max(0, Math.round((zonesRawSum - pointTotal) * 100) / 100);
  return { zoneIds, weights, deficit };
}

// Суммарный пул точки — для общей инкассации: прибавляется к введённой сумме
// перед пропорциональной разбивкой по зонам (distributeCollectionWhole),
// чтобы полная инкассация всех зон реально обнуляла их журнал, а не только
// экран.
export async function getPointPoolDeficit(pointId: string): Promise<number> {
  return (await computeZonePool(pointId)).deficit;
}

// Доля пула конкретной зоны — для инкассации ОДНОЙ зоны: та же пропорция,
// что и в общей разбивке, но нужна только сумма для этой зоны.
export async function getZonePoolShare(pointId: string, zoneId: string): Promise<number> {
  const { zoneIds, weights, deficit } = await computeZonePool(pointId);
  if (deficit === 0) return 0;
  const shares = distributeCollectionWhole(deficit, weights);
  const idx = zoneIds.indexOf(zoneId);
  return idx === -1 ? 0 : shares[idx];
}
