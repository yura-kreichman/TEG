import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { distributeCollectionWhole } from "@/lib/collection-split";

// Типы операций, которые НЕ лежат физически в кассе (docs/spec/02-money.md) —
// revenue_cashless (безнал), а с абонементами (запрос пользователя
// 2026-07-17) ещё два: abonement_topup_cashless (пополнение безналом — та же
// причина, что у revenue_cashless) и revenue_abonement (трата с баланса —
// реальных денег в этот момент не приходит, они пришли раньше, при
// пополнении). abonement_topup (пополнение НАЛИЧНЫМИ) в списке нет
// специально — это реальные деньги в кассе точки прямо сейчас, ровно как
// revenue. Товары (docs/spec/09-goods.md) — та же логика: goods_revenue_cashless
// и goods_revenue_abonement исключены тем же принципом, что и их зонные
// аналоги; goods_revenue (нал) в списке нет — реальные деньги, ровно как revenue.
// Билеты (docs/spec/10-tickets.md, "ДЕНЬГИ И СДАЧА ИТОГОВ") — возврат при
// аннулировании ПОСЛЕ сдачи итогов ПЕРЕИСПОЛЬЗУЕТ revenue/revenue_cashless/
// revenue_abonement отрицательной суммой (src/lib/tickets.ts,
// ticketRefundMoneyType — исправлено при аудите отчётов 2026-07-21: отдельные
// ticket_refund* типы корректно исключались отсюда, но ни один отчёт
// "Выручка" их не суммировал, возврат молча не уменьшал показанную выручку),
// отдельных типов под билеты здесь больше нет — тот же паттерн, что уже был
// у Товаров (goods_revenue* ниже, voidGoodsSale тоже переиспользует
// исходный тип, а не отдельный "goods_refund").
// collection_advance (см. "Аванс инкассации" ниже) — НАМЕРЕННО тоже исключён,
// но по другой причине, чем остальные здесь: это не безналичная операция,
// деньги реальны и физически покинули точку. Причина исключения — не
// смешиваться с getPointCashBalance/computeZonePool ниже: та пара функций уже
// считает дефицит аванса/премии сотрудника (деньги, которые ушли из кассы БЕЗ
// соответствующей зонной операции) и добавляет его к СЛЕДУЮЩЕЙ инкассации
// через distributeCollectionWhole — она не хранит "кто уже погашен", просто
// пересчитывает дефицит каждый раз заново из истории. Если бы collection_advance
// участвовал в этой сумме, тот же дефицит пересчитывался бы заново на КАЖДОЙ
// следующей инкассации бесконечно (проверено трассировкой при проектировании
// 2026-07-22: списание с зоны создаёт зонную операцию, которая сама
// увеличивает pointTotal обратно, но collection_advance остаётся навсегда —
// дефицит от него никогда бы не исчезал). У "Аванса инкассации" свой
// независимый учёт — см. getOutstandingCollectionAdvance/
// settleOutstandingCollectionAdvance.
// collection_pool_sweep_abonement / collection_pool_sweep_goods — точечные
// записи о том, что абонементы/товары наличными физически забраны
// инкассацией (запрос пользователя 2026-07-22: "абонементы исчезли а в
// реестре ничего не добавилось" — реальная сумма нужна отдельной строкой в
// Реестре инкассаций). Два РАЗНЫХ типа, не один общий (тот же день, второй
// запрос пользователя: "могут быть и 2 пачки — Сотрудник продавал
// абонементы, а продавец Поп-корн" — это физически разные деньги, инкассация
// одной пачки не должна молча "решать", что вторая тоже забрана). Исключены
// из affectsCashOnHand по той же причине, что и collection_advance —
// getPointAbonementCashTotal/getPointGoodsCashTotal уже вычитают эти деньги
// своей отсечкой по времени, повторный учёт здесь задвоил бы вычитание.
const CASH_EXCLUDED_TYPES = new Set([
  "revenue_cashless",
  "abonement_topup_cashless",
  "revenue_abonement",
  "goods_revenue_cashless",
  "goods_revenue_abonement",
  "collection_advance",
  "collection_pool_sweep_abonement",
  "collection_pool_sweep_goods",
]);

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

async function latestOccurredAt(where: Prisma.MoneyOperationWhereInput): Promise<Date | null> {
  const row = await prisma.moneyOperation.findFirst({
    where,
    select: { occurredAt: true },
    orderBy: { occurredAt: "desc" },
  });
  return row?.occurredAt ?? null;
}

// Момент последней "настоящей" инкассации на точке — для отсечки
// аванса/премии сотрудника (docs/spec/05-work-time.md). Максимум среди:
// zone-level "collection" по любой её зоне (инкассация ЛЮБОЙ одной зоны
// значит "владелец лично на точке пересчитал и забрал деньги" — решение
// пользователя 2026-07-16) и точечной "collection_advance" (та тоже момент
// "владелец был здесь и забирал", просто часть суммы ушла в аванс — иначе
// инкассация, целиком ушедшая в аванс без единой зонной операции, не
// двигала бы эту отсечку вообще).
//
// НЕ включает collection_pool_sweep_abonement/_goods — те двигают СВОИ
// собственные, независимые отсечки ниже (getPoolSweepCutoff), а не эту.
// Раньше (до 2026-07-22) все инкассации точки делили одну общую отсечку —
// нашёлся реальный баг на живом сценарии: "могут быть и 2 пачки — Сотрудник
// продавал абонементы, а продавец Поп-корн" — инкассация ТОЛЬКО абонементной
// пачки ложно обнуляла и ещё не забранную товарную кассу тоже, раз обе
// сверялись по одной и той же дате последней инкассации.
async function getZoneCollectionCutoff(pointId: string, zoneIds: string[]): Promise<Date | null> {
  const [zoneAt, advanceAt] = await Promise.all([
    zoneIds.length ? latestOccurredAt({ zoneId: { in: zoneIds }, type: "collection" }) : Promise.resolve(null),
    latestOccurredAt({ pointId, type: "collection_advance" }),
  ]);
  const dates = [zoneAt, advanceAt].filter((d): d is Date => d !== null);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

// Отсечка конкретного пула (абонементы ИЛИ товары наличными, не обеих сразу) —
// момент, когда ИМЕННО этот пул последний раз физически забирался
// инкассацией (collection_pool_sweep_abonement/_goods). Независима от
// getZoneCollectionCutoff выше и от отсечки другого пула — см. комментарий
// там же про "2 пачки".
async function getPoolSweepCutoff(pointId: string, sweepType: string): Promise<Date | null> {
  return latestOccurredAt({ pointId, type: sweepType });
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
//    последней инкассации на точке — актуален только "хвост" после неё.
//    Найдено и проверено на реальных данных 2026-07-16: аванс/премия
//    оператора от предыдущего дня не должны тянуть остаток в минус, если
//    после них уже прошла инкассация.
// Используется и для отображения (docs/spec/05-work-time.md), и для
// валидации максимального самостоятельного аванса/премии сотрудника —
// единая цифра, на которую опираются оба места.
export async function getPointCashBalance(pointId: string): Promise<number> {
  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);

  const [zoneOps, pointOps, zoneCollectionCutoff, abonementCutoff, goodsCutoff] = await Promise.all([
    zoneIds.length ? prisma.moneyOperation.findMany({ where: { zoneId: { in: zoneIds } } }) : Promise.resolve([]),
    prisma.moneyOperation.findMany({ where: { pointId } }),
    getZoneCollectionCutoff(pointId, zoneIds),
    getPoolSweepCutoff(pointId, "collection_pool_sweep_abonement"),
    getPoolSweepCutoff(pointId, "collection_pool_sweep_goods"),
  ]);

  let total = 0;
  for (const op of zoneOps) {
    if (!affectsCashOnHand(op.type)) continue;
    total += Number(op.amount);
  }
  for (const op of pointOps) {
    if (!affectsCashOnHand(op.type)) continue;
    if (op.type === "advance" || op.type === "bonus_payout") {
      if (op.performedByUserId) continue;
      if (zoneCollectionCutoff && op.occurredAt <= zoneCollectionCutoff) continue;
    }
    // Абонементные/товарные наличные, собранные ДО СВОЕЙ ПОСЛЕДНЕЙ инкассации
    // (не общей — см. getPoolSweepCutoff), считаются уже забранными
    // (запрос пользователя 2026-07-18, разделено на два независимых пула
    // 2026-07-22 — docs/spec/09-goods.md, "Деньги").
    if (op.type === "abonement_topup" && abonementCutoff && op.occurredAt <= abonementCutoff) continue;
    if (op.type === "goods_revenue" && goodsCutoff && op.occurredAt <= goodsCutoff) continue;
    total += Number(op.amount);
  }
  return total;
}

// Немедленное разнесение самообслуживаемого аванса/премии по зонам точки
// (запрос пользователя 2026-07-25: "чтобы сразу разносились", а не только
// на следующей инкассации) — та же пропорциональная разбивка, что у обычной
// инкассации (distributeCollectionWhole), просто по ТЕКУЩИМ остаткам зон в
// момент взятия, а не по остаткам на момент следующей инкассации. Раньше
// (getPointPoolDeficit/getZonePoolShare выше) эффект был виден только
// вычитанием на экране "Остатки по зонам" и доразносился реальными
// zone-level записями лишь при следующей инкассации — владелец видел
// "внезапное" списание зон задним числом, без понятной причины. Тот старый
// механизм остаётся как есть — он и дальше корректно доразносит уже
// накопленные ДО этой функции долги (обратная совместимость), а для НОВЫХ
// авансов/премий poolDeficit с самого начала будет 0 (zonesRawSum и
// pointTotal падают на одну и ту же сумму в один момент, разница не меняется).
//
// ВАЖНО: вызывать СРАЗУ ПОСЛЕ создания самой advance/bonus_payout операции,
// не раньше и не параллельно — её occurredAt должен быть строго ДО зонных
// записей ниже (обычный Prisma-инсерт со своим now() после предыдущего
// await это и так гарантирует). Иначе getPointCashBalance
// (zoneCollectionCutoff = момент последней zone-level "collection") не
// исключит advance/bonus_payout из своего расчёта, и те же деньги вычтутся
// из остатка точки дважды — один раз зонными записями тут, второй раз самой
// advance-записью.
export async function chargeSelfServiceAdvanceToZones(
  tenantId: string,
  pointId: string,
  amount: number,
  performedByOperatorId: string
): Promise<void> {
  if (amount <= 0) return;
  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  if (zones.length === 0) return;

  const balanceByZone = await getZoneBalances(zones.map((z) => z.id));
  const weights = zones.map((z) => balanceByZone.get(z.id) ?? 0);
  const shares = distributeCollectionWhole(amount, weights);

  const rows = zones
    .map((zone, i) => ({
      tenantId,
      zoneId: zone.id,
      type: "collection",
      amount: -Math.abs(shares[i]),
      performedByOperatorId,
    }))
    .filter((row) => row.amount !== 0);

  if (rows.length > 0) {
    await prisma.moneyOperation.createMany({ data: rows });
  }
}

// Сколько из остатка кассы точки — продажи абонементов наличными, ещё НЕ
// инкассированные (запрос пользователя 2026-07-18: "выделить абонементные
// деньги из общего pool в свою явную строку" + "инкассация должна работать
// по абсолютно всем наличным деньгам на точке") — своя отсечка, независимая
// от товарной кассы (getPoolSweepCutoff, см. комментарий там же). Только
// НАЛИЧНЫЕ (abonement_topup) — безнал (abonement_topup_cashless) физически
// не в кассе, уже исключён affectsCashOnHand.
export async function getPointAbonementCashTotal(pointId: string): Promise<number> {
  const cutoff = await getPoolSweepCutoff(pointId, "collection_pool_sweep_abonement");
  const ops = await prisma.moneyOperation.findMany({
    where: {
      pointId,
      type: "abonement_topup",
      ...(cutoff ? { occurredAt: { gt: cutoff } } : {}),
    },
    select: { amount: true },
  });
  return ops.reduce((sum, op) => sum + Number(op.amount), 0);
}

// Товарные наличные (docs/spec/09-goods.md, "Деньги") — тот же принцип, что
// у getPointAbonementCashTotal выше, но своя, независимая отсечка (см.
// getPoolSweepCutoff) — нужен явной цифрой для потолка "что честно
// раскладывается по зонам" при инкассации, см. splitCollectionAmountDetailed.
export async function getPointGoodsCashTotal(pointId: string): Promise<number> {
  const cutoff = await getPoolSweepCutoff(pointId, "collection_pool_sweep_goods");
  const ops = await prisma.moneyOperation.findMany({
    where: {
      pointId,
      type: "goods_revenue",
      ...(cutoff ? { occurredAt: { gt: cutoff } } : {}),
    },
    select: { amount: true },
  });
  return ops.reduce((sum, op) => sum + Number(op.amount), 0);
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

// "Аванс инкассации" (запрос пользователя 2026-07-22): владелец физически
// забирает БОЛЬШЕ, чем сейчас числится в остатках зон — например, вперемешку
// вчерашнюю кассу и сегодняшнюю, которую Сотрудник ещё не сдал. Деньги
// реально лежат одной пачкой, разложить их по зонам достоверно нельзя.
// Раньше вся введённая сумма пропорционально размазывалась по ТЕКУЩИМ весам
// зон (distributeCollectionWhole) — "лишняя" часть уходила на зону, у
// которой СЕЙЧАС есть остаток, уводя её в ложный минус, хотя по смыслу эти
// деньги принадлежат зоне, которая просто ещё не сдавала итоги. Решение:
// по зонам распределяется не больше, чем в них реально числится сейчас
// (splitCollectionAmountDetailed ниже), а излишек откладывается отдельной
// точечной операцией без zoneId — не привязывая его ни к одной зоне
// произвольно.
export async function getOutstandingCollectionAdvance(pointId: string): Promise<number> {
  const ops = await prisma.moneyOperation.findMany({
    where: { pointId, type: "collection_advance" },
    select: { amount: true },
  });
  const sum = ops.reduce((acc, op) => acc + Number(op.amount), 0);
  // Хранится отрицательным (деньги покинули точку, тот же знак, что у
  // аванса/премии сотрудника) — наружу отдаём положительным "сколько ещё не
  // разнесено по зонам".
  return Math.max(0, Math.round(-sum * 100) / 100);
}

// Делит запрошенную к инкассации сумму на ЧЕТЫРЕ части (запрос пользователя
// 2026-07-22, найдено на реальных данных: инкассация ровно на сумму
// абонементов размазывалась по зонам как обычная выручка через
// distributeCollectionWhole, уводя их в ложный минус — зонам эти деньги не
// принадлежат, но и "авансом" их считать неверно, это не ожидание будущей
// выручки, а уже готовые деньги без зоны-адреса):
//  1. zonePortion — раскладывается по зонам как обычно, не больше их
//     текущего остатка.
//  2. abonementSweepPortion / 3. goodsSweepPortion — абонементы и товары
//     наличными: не привязаны ни к одной зоне НИКОГДА, в зонный collection
//     не идут вообще; каждый — своя точечная операция с реальной суммой (не
//     маркер), чтобы показаться в Реестре инкассаций и сдвинуть СВОЮ,
//     независимую отсечку (см. getPoolSweepCutoff — "2 пачки", запрос
//     пользователя 2026-07-22). Порядок покрытия — сначала абонементы, потом
//     товары (последовательно, не пропорционально: это две самостоятельные
//     кассы, а не общий вес одной величины).
//  4. advance — то, для чего вообще нет ни зоны, ни пула (деньги, которых
//     ещё нет нигде в системе, например ещё не сданные Сотрудником итоги) —
//     настоящий "Аванс инкассации", ждёт будущей выручки для погашения.
export function splitCollectionAmountDetailed(
  requested: number,
  zonesRawSum: number,
  abonementPool: number,
  goodsPool: number
): { zonePortion: number; abonementSweepPortion: number; goodsSweepPortion: number; advance: number } {
  const zonePortion = Math.max(0, Math.min(requested, Math.max(0, zonesRawSum)));
  let remaining = requested - zonePortion;
  const abonementSweepPortion = Math.max(0, Math.min(remaining, Math.max(0, abonementPool)));
  remaining -= abonementSweepPortion;
  const goodsSweepPortion = Math.max(0, Math.min(remaining, Math.max(0, goodsPool)));
  remaining -= goodsSweepPortion;
  return {
    zonePortion: Math.round(zonePortion * 100) / 100,
    abonementSweepPortion: Math.round(abonementSweepPortion * 100) / 100,
    goodsSweepPortion: Math.round(goodsSweepPortion * 100) / 100,
    advance: Math.round(remaining * 100) / 100,
  };
}

type CollectionActor = { performedByUserId?: string; performedByOperatorId?: string };

// Гасит накопленный аванс инкассации остатками зон точки, если они уже
// появились (Сотрудник наконец сдал итоги) — вызывается ПЕРВЫМ шагом в
// каждом из /api/zones/[id]/collection, /api/points/[id]/collection/general
// и их operator-аналогов, до расчёта самой новой инкассации: свежие остатки
// зон после гашения используются дальше как основа для
// splitCollectionAmountDetailed новой суммы.
//
// НЕ через общий computeZonePool/deficit выше (deficit пересчитывается
// заново из истории каждый раз, ничего не "помнит" как погашенное) — при
// проектировании 2026-07-22 трассировкой найдено, что зонная операция
// погашения сама поднимает pointTotal обратно, но collection_advance в
// истории остаётся навсегда, и тот же дефицит бесконечно пересчитывался бы
// на каждой следующей инкассации, списывая с зон снова и снова. Здесь вместо
// этого — явная компенсирующая операция +settleable на каждое погашение,
// поэтому исходная -отрицательная сумма аванса гасится РОВНО один раз на
// каждую распределённую часть, без повторного срабатывания.
export async function settleOutstandingCollectionAdvance(
  tenantId: string,
  pointId: string,
  actor: CollectionActor
): Promise<number> {
  const outstanding = await getOutstandingCollectionAdvance(pointId);
  if (outstanding <= 0) return 0;

  const zones = await prisma.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);
  if (zoneIds.length === 0) return 0;

  const balances = await getZoneBalances(zoneIds);
  const weights = zoneIds.map((id) => balances.get(id) ?? 0);
  const zonesRawSum = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  const settleable = Math.round(Math.min(outstanding, zonesRawSum) * 100) / 100;
  if (settleable <= 0) return 0;

  const shares = distributeCollectionWhole(settleable, weights);
  const rows = zoneIds
    .map((zoneId, i) => ({
      tenantId,
      zoneId,
      type: "collection",
      amount: -Math.abs(shares[i]),
      performedByUserId: actor.performedByUserId,
      performedByOperatorId: actor.performedByOperatorId,
    }))
    .filter((row) => row.amount !== 0);

  if (rows.length > 0) await prisma.moneyOperation.createMany({ data: rows });

  await prisma.moneyOperation.create({
    data: {
      tenantId,
      pointId,
      type: "collection_advance",
      amount: settleable,
      performedByUserId: actor.performedByUserId,
      performedByOperatorId: actor.performedByOperatorId,
    },
  });

  return settleable;
}
