import { prisma } from "@/lib/prisma";
import { previousSubmissionBoundary } from "@/lib/game-room";

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
 * Отдаём СПИСОК МОМЕНТОВ, а не одно число, и это принципиально. Первая
 * версия (2026-09-03, прожила час на проде) прибавляла к остатку всю
 * невнесённую выручку на ТЕКУЩИЙ момент — и делала это для каждой операции
 * окна, включая те, что случились раньше самой выручки. Деньги, заработанные
 * сегодня, задним числом наполняли вчерашний ящик:
 *
 *   Игроленд, Детский лабиринт
 *   02.09 18:42  инкассация −11400, касса 0 — забрали ВСЁ, размен обязан
 *                обнулиться вместе с кассой
 *   03.09 07:36  внесли новый размен 450
 *   03.09        за день накапало 750 невнесённой выручки
 *   было:  на вчерашней инкассации ящик «содержал» 0 + 750, обрезка не
 *          сработала, и размен вышел 1200 вместо 450 — врал на 750
 *   стало: к 02.09 18:42 накоплено 0, обрезка срабатывает, размен 450 ✓
 *
 * Оценка сознательно ЗАНИЖЕНА: разбитые оплаты и пуски без указанного
 * способа не считаются. Занизив, мы возвращаемся к прежнему поведению —
 * завысив, раздули бы размен, а это и была ошибка.
 *
 * Режим «Счётчики» оценивается по тапам, а не по показаниям: показания зона
 * узнаёт лишь в момент сдачи, а тап — это уже состоявшаяся оплата. Оценка
 * снизу, и это правильная сторона: занизив её, мы лишь вернёмся к прежнему
 * поведению, а завысив — раздули бы размен.
 *
 * «Только касса» не оценивается вовсе (0): там нет ни счётчиков, ни пусков,
 * выручка существует только как введённая сотрудником сумма.
 */
export interface PendingCashEvent {
  at: Date;
  amount: number;
}

export async function getPendingCashRevenueEventsByZone(
  zones: { id: string; accountingMode: string }[],
  until: Date,
  client: Tx | typeof prisma = prisma
): Promise<Map<string, PendingCashEvent[]>> {
  const result = new Map<string, PendingCashEvent[]>();
  if (zones.length === 0) return result;

  await Promise.all(
    zones.map(async (zone) => {
      const since = await previousSubmissionBoundary(zone.id, client);
      const window = since ? { gt: since, lt: until } : { lt: until };
      const rows: PendingCashEvent[] = [];

      if (zone.accountingMode === "counters") {
        const taps = await client.counterTapEvent.findMany({
          where: { zoneId: zone.id, voidedAt: null, paymentMethod: "cash", createdAt: window },
          select: { createdAt: true, priceSnapshot: true, tariff: { select: { price: true } } },
        });
        for (const t of taps) {
          rows.push({ at: t.createdAt, amount: Number(t.priceSnapshot ?? t.tariff?.price ?? 0) });
        }
      } else if (zone.accountingMode === "stays" || zone.accountingMode === "launches") {
        // Только ЗАКРЫТЫЕ пуски с посчитанной суммой. У открытого «По факту»
        // amount ещё null, а priceSnapshot там — ставка за МИНУТУ, не итог:
        // подставив её, мы завысили бы ящик и не дали обрезке сработать. Это
        // ровно тот перекос, который прожил час на проде 3 сентября, поэтому
        // здесь сознательно занижаем: «За вход», оплаченный вперёд и ещё
        // идущий, в оценку не попадёт, и обрезка отработает как раньше.
        const launches = await client.launch.findMany({
          where: {
            zoneId: zone.id,
            voidedAt: null,
            paymentMethod: "cash",
            amount: { not: null },
            startedAt: window,
          },
          select: { startedAt: true, endedAt: true, amount: true },
        });
        for (const l of launches) {
          rows.push({ at: l.endedAt ?? l.startedAt, amount: Number(l.amount) });
        }
      } else if (zone.accountingMode === "tickets") {
        const orders = await client.ticketOrder.findMany({
          where: { zoneId: zone.id, paymentMethod: "cash", soldAt: window },
          select: { soldAt: true, totalSnapshot: true },
        });
        for (const o of orders) rows.push({ at: o.soldAt, amount: Number(o.totalSnapshot) });
      }

      rows.sort((a, b) => a.at.getTime() - b.at.getTime());
      result.set(zone.id, rows);
    })
  );

  return result;
}

/** Та же выручка одним числом — когда нужен только итог, а не моменты. */
export async function getPendingCashRevenueByZone(
  zones: { id: string; accountingMode: string }[],
  until: Date,
  client: Tx | typeof prisma = prisma
): Promise<Map<string, number>> {
  const events = await getPendingCashRevenueEventsByZone(zones, until, client);
  const result = new Map<string, number>();
  for (const [zoneId, rows] of events) {
    result.set(zoneId, round2(rows.reduce((acc, r) => acc + r.amount, 0)));
  }
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
