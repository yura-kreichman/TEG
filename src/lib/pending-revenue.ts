import { prisma } from "@/lib/prisma";
import {
  aggregateGameRoomLaunches,
  aggregateOpenPrepaidLaunches,
  previousSubmissionBoundary,
} from "@/lib/game-room";
import { aggregateTicketOrders } from "@/lib/tickets";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Наличная выручка зоны, которую сотрудник ЕЩЁ НЕ СДАЛ, — то есть та, что
 * физически лежит в ящике, но в журнал не попала.
 *
 * Зачем это нужно (закрывающий аудит 2026-09-03, решение владельца). Журнальный
 * остаток зоны среди дня меньше содержимого ящика ровно на эту величину:
 * выручка журналируется одной строкой при сдаче итогов, а деньги в ящик
 * попадают весь день. Всё, что сравнивает «сколько в ящике» с журналом, среди
 * дня ошибается — и первым ошибался размен:
 *
 *   в ящике размен 500, журнальный остаток тоже 500
 *   днём владелец берёт 300 (в ящике при этом уже 4000 сегодняшней выручки)
 *   журнальный остаток 200 → размен обрезался до 200 НАВСЕГДА
 *   вечером в ящике 500 размена + 4000 выручки, сотрудник вводит 4500,
 *   подсказка считает выручку как 4500 − 200 = 4300 вместо 4000
 *
 * Физически владелец забрал выручку, а не размен: размен уходит последним.
 * Прибавив это число к остатку, обрезка снова отвечает на верный вопрос —
 * «влезло ли забранное в то, что было в ящике кроме размена».
 *
 * Считаем ТОЛЬКО наличные: безнал и баланс абонемента в ящик не попадают.
 *
 * Режим «Счётчики» оценивается по тапам, а не по показаниям: показания зона
 * узнаёт лишь в момент сдачи, а тап — это уже состоявшаяся оплата. Оценка
 * снизу, и это правильная сторона: занизив её, мы лишь вернёмся к прежнему
 * поведению, а завысив — раздули бы размен.
 *
 * «Только касса» не оценивается вовсе (0): там нет ни счётчиков, ни пусков,
 * выручка существует только как введённая сотрудником сумма.
 */
export async function getPendingCashRevenueByZone(
  zones: { id: string; accountingMode: string }[],
  until: Date,
  client: Tx | typeof prisma = prisma
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (zones.length === 0) return result;

  await Promise.all(
    zones.map(async (zone) => {
      const since = await previousSubmissionBoundary(zone.id, client);

      if (zone.accountingMode === "tickets") {
        const agg = await aggregateTicketOrders(zone.id, since, until, client);
        result.set(zone.id, round2(agg.cashAmount));
        return;
      }

      if (zone.accountingMode === "stays" || zone.accountingMode === "launches") {
        // Идущие браслеты «За вход» — деньги за них уже в ящике: оплата
        // берётся при старте (см. aggregateOpenPrepaidLaunches).
        const [closed, openPrepaid] = await Promise.all([
          aggregateGameRoomLaunches(zone.id, since, until, client),
          aggregateOpenPrepaidLaunches(zone.id, since, until, client),
        ]);
        result.set(zone.id, round2(closed.cashAmount + openPrepaid.cashAmount));
        return;
      }

      if (zone.accountingMode === "counters") {
        // Тапы с наличной оплатой за то же окно. Отменённые («Возврат/тест»)
        // не в счёт — денег за них в ящике нет. Цена берётся из снимка на
        // момент тапа, а при его отсутствии (записи старше миграции) — из
        // текущего тарифа, тем же порядком, что и возврат в tap-events.
        const taps = await client.counterTapEvent.findMany({
          where: {
            zoneId: zone.id,
            voidedAt: null,
            paymentMethod: "cash",
            ...(since ? { createdAt: { gt: since, lt: until } } : { createdAt: { lt: until } }),
          },
          select: { priceSnapshot: true, tariff: { select: { price: true } } },
        });
        const sum = taps.reduce(
          (acc, t) => acc + Number(t.priceSnapshot ?? t.tariff?.price ?? 0),
          0
        );
        result.set(zone.id, round2(sum));
        return;
      }

      result.set(zone.id, 0);
    })
  );

  return result;
}

/**
 * Сколько владелец забрал «Авансовой инкассацией» за окно — то есть сверх
 * учтённых остатков зон, общей инкассацией по точке.
 *
 * Зонная инкассация уводит зону в минус, и прирост этого минуса возвращается в
 * выручку сдачи (getZoneCollectionOverdraw). Общая — не уводит: она обрезает
 * зоны по остатку, а превышение кладёт отдельной строкой collection_advance,
 * которая балансов не двигает вовсе (она в CASH_EXCLUDED_TYPES). Дефицита нет
 * — поправки нет, и вечером «Разница» показывала недостачу из воздуха:
 *
 *   остатки зон 0, владелец берёт 300 общей инкассацией среди дня,
 *   вечером сотрудник вносит выручку 800 минус забранные 300 = 500
 *   было:  500 + 0 − 800 = −300 недостачи, которой нет
 *   стало: 500 + 300 − 800 = 0 ✓
 *
 * Ровно та же беда, что чинили КидсБургу 2 сентября, только другим путём
 * (решение владельца 2026-09-03: вернуть излишек, а не убирать потолок —
 * «Авансовая инкассация» как понятие остаётся).
 *
 * Берём только строки, созданные В ОКНЕ, и не больше непогашенного остатка:
 * аванс, висящий с прошлых дней, забирал деньги из ТОГО ящика, и в сегодняшнюю
 * «Разницу» ему нельзя. Его по-прежнему разносит settleOutstandingCollectionAdvance.
 *
 * Разнесение по зонам и последующее погашение сходятся в ноль по балансам:
 * зона получает лишнюю выручку, а settleOutstandingCollectionAdvance тут же
 * списывает её обратно — в ящике этих денег и правда нет.
 */
export async function getCollectionAdvanceTakenSince(
  pointId: string,
  since: Date | null,
  until: Date,
  client: Tx | typeof prisma = prisma
): Promise<number> {
  const all = await client.moneyOperation.findMany({
    where: { pointId, type: "collection_advance" },
    select: { amount: true, occurredAt: true },
  });
  // Непогашенный остаток: строки хранятся отрицательными («деньги ушли»), а
  // погашение добавляет положительные — см. getOutstandingCollectionAdvance.
  const outstanding = Math.max(0, -all.reduce((acc, o) => acc + Number(o.amount), 0));
  const takenInWindow = all
    .filter((o) => Number(o.amount) < 0 && o.occurredAt < until && (!since || o.occurredAt > since))
    .reduce((acc, o) => acc + Math.abs(Number(o.amount)), 0);
  return round2(Math.min(outstanding, takenInWindow));
}

/**
 * Разложить забранное общей инкассацией по зонам — пропорционально тому,
 * сколько наличной выручки каждая из них принесла в ящик за то же окно
 * (getPendingCashRevenueByZone). Деньги физически брались из общего ящика
 * точки, и это единственная доступная мера «чьи они были».
 *
 * Одна функция на оба экрана — мастер сотрудника и сдачу итогов: формула,
 * живущая в двух копиях, в этом коде уже расходилась не раз.
 *
 * Не из чего распределять (вся выручка окна безналичная или её нет) — делим
 * поровну: деньги из ящика всё равно вышли, промолчать о них хуже.
 */
export function allocateAdvanceToZones(
  advance: number,
  zoneIds: string[],
  pendingByZone: Map<string, number>
): Map<string, number> {
  const result = new Map<string, number>();
  if (advance <= 0 || zoneIds.length === 0) return result;

  const weights = zoneIds.map((id) => Math.max(0, pendingByZone.get(id) ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const basis = total > 0 ? weights : zoneIds.map(() => 1);
  const basisTotal = basis.reduce((a, b) => a + b, 0);

  // Остаток округления — последней зоне, как у долей корзины Товаров и билетов.
  let handed = 0;
  zoneIds.forEach((id, i) => {
    const share =
      i === zoneIds.length - 1
        ? round2(advance - handed)
        : round2((advance * basis[i]) / basisTotal);
    handed = round2(handed + share);
    if (share !== 0) result.set(id, share);
  });
  return result;
}
