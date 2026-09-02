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
// одной пачки не должна молча "решать", что вторая тоже забрана).
//
// Сами свипы (collection_pool_sweep_abonement/_goods) в этом списке БОЛЬШЕ НЕ
// СТОЯТ — генеральная проверка финансов 2026-09-02. Раньше пулы вычитались
// отсечкой по времени: свип помечал момент, и всё, что собрано до него,
// считалось забранным целиком. Но забрать можно и ЧАСТЬ: инкассация товарной
// кассы на 100 из 500 стирала все 500 — четыреста рублей пропадали с экрана,
// хотя физически лежали в ящике. Теперь свип — обычная отрицательная
// операция кассы: вычитается ровно на свою сумму, и «частично» получается
// само собой, без единой отсечки.
const CASH_EXCLUDED_TYPES = new Set([
  "revenue_cashless",
  "abonement_topup_cashless",
  "revenue_abonement",
  "goods_revenue_cashless",
  "goods_revenue_abonement",
  "collection_advance",
  // bonus_accrual (запрос пользователя 2026-08-12, режим "Только начисление"
  // в Настройки → Система) — единственный тип здесь, который вообще не
  // движение денег: премия начислена сотруднику в баланс "к выдаче", но
  // наличными не выдана, из кассы точки не уходило ничего. Соответственно
  // не участвует ни в остатке кассы, ни в зонном разнесении, ни в дефиците
  // пула — начисление станет реальными деньгами только когда сотрудник
  // возьмёт его авансом (advance), и вот тот уже обычная кассовая операция.
  "bonus_accrual",
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
type Tx = Prisma.TransactionClient;

export async function getZoneBalances(
  zoneIds: string[],
  client: Tx | typeof prisma = prisma
): Promise<Map<string, number>> {
  if (zoneIds.length === 0) return new Map();

  const operations = await client.moneyOperation.findMany({
    where: { zoneId: { in: zoneIds } },
  });

  const balanceByZone = new Map<string, number>();
  for (const op of operations) {
    if (!affectsCashOnHand(op.type) || !op.zoneId) continue;
    balanceByZone.set(op.zoneId, (balanceByZone.get(op.zoneId) ?? 0) + Number(op.amount));
  }
  return balanceByZone;
}

async function latestOccurredAt(
  where: Prisma.MoneyOperationWhereInput,
  client: Tx | typeof prisma = prisma
): Promise<Date | null> {
  const row = await client.moneyOperation.findFirst({
    where,
    select: { occurredAt: true },
    orderBy: { occurredAt: "desc" },
  });
  return row?.occurredAt ?? null;
}

// Момент последней "настоящей" инкассации на точке — для отсечки
// аванса/премии сотрудника (docs/spec/05-work-time.md). Максимум среди:
// zone-level "collection"/"advance_settlement" по любой её зоне (инкассация
// ЛЮБОЙ одной зоны значит "владелец лично на точке пересчитал и забрал
// деньги" — решение пользователя 2026-07-16; advance_settlement — та же
// логика "касса зоны только что честно обнулилась", просто не рукой
// владельца, а автоматическим погашением, см. chargeSelfServiceAdvanceToZones/
// settleOutstandingCollectionAdvance ниже) и точечной "collection_advance"
// (та тоже момент "владелец был здесь и забирал", просто часть суммы ушла в
// аванс — иначе инкассация, целиком ушедшая в аванс без единой зонной
// операции, не двигала бы эту отсечку вообще).
//
// НЕ включает collection_pool_sweep_abonement/_goods — те двигают СВОИ
// собственные, независимые отсечки ниже (getPoolSweepCutoff), а не эту.
// Раньше (до 2026-07-22) все инкассации точки делили одну общую отсечку —
// нашёлся реальный баг на живом сценарии: "могут быть и 2 пачки — Сотрудник
// продавал абонементы, а продавец Поп-корн" — инкассация ТОЛЬКО абонементной
// пачки ложно обнуляла и ещё не забранную товарную кассу тоже, раз обе
// сверялись по одной и той же дате последней инкассации.
async function getZoneCollectionCutoff(
  pointId: string,
  zoneIds: string[],
  client: Tx | typeof prisma = prisma,
  asOf?: Date
): Promise<Date | null> {
  const upTo = asOf ? { occurredAt: { lt: asOf } } : {};
  const [zoneAt, advanceAt] = await Promise.all([
    zoneIds.length
      ? latestOccurredAt(
          { zoneId: { in: zoneIds }, type: { in: ["collection", "advance_settlement"] }, ...upTo },
          client
        )
      : Promise.resolve(null),
    latestOccurredAt({ pointId, type: "collection_advance", ...upTo }, client),
  ]);
  const dates = [zoneAt, advanceAt].filter((d): d is Date => d !== null);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

// Отсечки по свипу пула здесь больше нет (генеральная проверка финансов
// 2026-09-02): пулы абонементов и товаров вычитаются суммой самих свипов, а
// не датой последнего из них. Разделение на две независимые пачки (решение
// 2026-07-22, комментарий про «2 пачки» выше) при этом сохраняется — просто
// теперь оно держится на типе операции, а не на двух отдельных отсечках.

// Физический остаток кассы точки в целом = сумма остатков её зон + операции,
// привязанные к точке целиком (аванс/премия — из общей кассы точки, не
// конкретной зоны). Источник денег на аванс/премию зависит от двух вещей
// (решение пользователя 2026-07-15/16, docs/spec/05-work-time.md):
// 1. Владелец вносит вручную из карточки сотрудника (только
//    performedByUserId, performedByOperatorId пуст) — деньги не из кассы
//    точки (уже забраны инкассацией, или переданы отдельно, например
//    переводом на карту) — кассы точки не касается, остаток не уменьшает,
//    вне зависимости от даты.
// 2. Деньги ушли из кассы точки в руки сотрудника (performedByOperatorId) —
//    физически берёт из кассы точки, но только если это произошло ПОСЛЕ
//    последней инкассации на точке — актуален только "хвост" после неё.
//    Найдено и проверено на реальных данных 2026-07-16: аванс/премия
//    оператора от предыдущего дня не должны тянуть остаток в минус, если
//    после них уже прошла инкассация.
//
// Признак — именно performedByOperatorId, а НЕ отсутствие performedByUserId
// (правка владельца 2026-08-31, реальный случай КидсБурга): аванс, который
// владелец дописывает в уже закрытую СМЕНУ, — это деньги, которые сотрудник
// в тот день реально забрал из кассы, просто не отметил в PWA. Такая запись
// теперь несёт ОБА поля: performedByOperatorId (из чьих рук ушли деньги) и
// performedByUserId (кто внёс запись) — см. syncLinkedOp в
// /api/work-time/shifts/[id]. Старая проверка "if (performedByUserId)
// continue" пропускала её мимо кассы, и остаток точки не уменьшался вовсе.
// Для всех записей, созданных до этой правки, условие эквивалентно прежнему:
// у аванса/премии всегда было заполнено ровно одно из двух полей.
// Используется и для отображения (docs/spec/05-work-time.md), и для
// валидации максимального самостоятельного аванса/премии сотрудника —
// единая цифра, на которую опираются оба места.
//
// asOf — «сколько было в кассе на этот момент», а не «сколько сейчас» (нужно
// «Итогам дня»: по календарю листают назад, и текущий остаток там был бы
// откровенной ложью). Граница односторонняя, снизу её нет и быть не может:
// остаток — это накопленный итог с начала, обрезать его слева значит выкинуть
// прошлые инкассации и получить чужое число. Отсечки последних инкассаций
// тоже считаются НА ЭТОТ МОМЕНТ — иначе инкассация, сделанная уже после
// выбранной даты, задним числом обнулила бы кассу того дня.
export async function getPointCashBalance(
  pointId: string,
  client: Tx | typeof prisma = prisma,
  asOf?: Date
): Promise<number> {
  const zones = await client.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);
  const upTo = asOf ? { occurredAt: { lt: asOf } } : {};

  const [zoneOps, pointOps, zoneCollectionCutoff] = await Promise.all([
    // select только нужных полей (аудит производительности 2026-08-13):
    // раньше тянулись все колонки каждой операции точки за всё время, а
    // используются четыре; удешевляем чтение, а не меняем смысл. Ведущий
    // индекс [zoneId, occurredAt] добавлен той же правкой.
    zoneIds.length
      ? client.moneyOperation.findMany({
          where: { zoneId: { in: zoneIds }, ...upTo },
          select: { type: true, amount: true, occurredAt: true, performedByUserId: true },
        })
      : Promise.resolve([]),
    client.moneyOperation.findMany({
      where: { pointId, ...upTo },
      select: { type: true, amount: true, occurredAt: true, performedByOperatorId: true },
    }),
    getZoneCollectionCutoff(pointId, zoneIds, client, asOf),
  ]);

  let total = 0;
  for (const op of zoneOps) {
    if (!affectsCashOnHand(op.type)) continue;
    total += Number(op.amount);
  }
  for (const op of pointOps) {
    if (!affectsCashOnHand(op.type)) continue;
    if (op.type === "advance" || op.type === "bonus_payout") {
      if (!op.performedByOperatorId) continue;
      if (zoneCollectionCutoff && op.occurredAt <= zoneCollectionCutoff) continue;
    }
    // Абонементные и товарные наличные (abonement_topup, goods_revenue,
    // goods_change_fund — «Размен» Товаров, запрос пользователя 2026-07-25)
    // складываются как есть, а забранное вычитают сами свипы своей
    // отрицательной суммой. Прежде здесь стояли две отсечки по времени, и
    // частичная инкассация пула списывала его ЦЕЛИКОМ (docs/spec/09-goods.md,
    // «Деньги»; два независимых пула — решение 2026-07-22, оно сохраняется:
    // свип абонементов не трогает товарные деньги и наоборот).
    total += Number(op.amount);
  }
  return total;
}

/**
 * Сколько размена ЛЕЖИТ В КАССЕ на момент asOf (по умолчанию — сейчас).
 *
 * Не то же самое, что «размен, внесённый за день»: размен привязан не к
 * календарю, а к промежутку между инкассациями. Вчерашние 500 ₽ физически в
 * ящике и сегодня, но в сумму «за сегодня» не попадут — а владельцу нужно
 * именно то, что в ящике (разбор с Игролендом 2026-09-02).
 *
 * ПРАВИЛО (решение владельца 2026-09-02, после генеральной проверки финансов):
 * **размен лежит в кассе, пока кассу не забрали целиком.**
 *
 *   касса 7045, из них размен 470
 *   забрали 1000  → в кассе 6045, размен 470   (лежит, как лежал)
 *   забрали 6575  → в кассе  470, размен 470
 *   забрали 6800  → в кассе  245, размен 245   (больше кассы размена не бывает)
 *   забрали всё   → в кассе    0, размен   0   (унесли вместе с выручкой)
 *
 * Утренняя версия отсекала размен ЛЮБОЙ инкассацией — и это породило три
 * находки проверки разом. Частичная инкассация обнуляла показанный размен,
 * хотя деньги физически оставались в ящике; чтобы это скрыть, роуты писали
 * парную операцию возврата, а она возвращала размен ЦЕЛИКОМ, сколько бы ни
 * забрали, дорисовывая деньги в журнал.
 *
 * Отсюда и нынешняя отсечка: не «последняя инкассация», а бегущий остаток
 * кассы — размен обрезается по нему на КАЖДОЙ операции. Обрезанное назад не
 * возвращается: пришедшая назавтра выручка поднимает кассу, но она выручка,
 * а не размен. Из отдельных операций этого не видно, нужен бегущий итог.
 * Заодно отпадают
 * парные операции: «оставить размен» = забрать на его сумму меньше, и он
 * останется сам, без единой записи в журнале.
 */
export async function getChangeFundInTillByZone(
  zoneIds: string[],
  client: Tx | typeof prisma = prisma,
  asOf?: Date
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!zoneIds.length) return result;
  const upTo = asOf ? { occurredAt: { lt: asOf } } : {};

  // Весь журнал зон, а не только размен: без бегущего баланса не видно, где
  // касса обнулялась. Фильтр по ЗОНЕ, не по точке — у зонных операций pointId
  // пуст всегда (CHECK MoneyOperation_zone_xor_point_check).
  const ops = await client.moneyOperation.findMany({
    where: { zoneId: { in: zoneIds }, ...upTo },
    select: { zoneId: true, type: true, amount: true, occurredAt: true },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });

  const running = new Map<string, number>();
  for (const op of ops) {
    if (!op.zoneId) continue;
    if (!affectsCashOnHand(op.type)) continue;
    const balance = Math.round(((running.get(op.zoneId) ?? 0) + Number(op.amount)) * 100) / 100;
    running.set(op.zoneId, balance);

    if (op.type === "change_fund") {
      result.set(op.zoneId, Math.round(((result.get(op.zoneId) ?? 0) + Number(op.amount)) * 100) / 100);
    }

    // Размен не может быть больше того, что физически в кассе — и проверять
    // это надо НА КАЖДОЙ операции, а не один раз в конце по итоговому
    // остатку. Разница видна, как только после просадки приходит выручка:
    // выручка поднимает кассу обратно, и финальная проверка снова пропускает
    // весь размен, хотя часть его уже уехала.
    //
    // Игроленд, 2026-09-02 (жалоба владельца «внесли 1350, пишет 1850»):
    //   23.08  размен +500                        касса   500   размен  500
    //   01.09  выручка +43400, инкассация −42050  касса  1850   размен  500
    //   01.09  размен +1350                       касса  3200   размен 1850
    //   01.09  инкассация −1800                   касса  1400   размен 1400 ← 450 уехало
    //   02.09  выручка +10000                     касса 11400   размен 1400
    // Финальная проверка сравнивала 1850 с 11400 и оставляла 1850.
    //
    // Касса в нуле (или в минусе — от аванса сотрудника) — частный случай той
    // же обрезки: в ящике не осталось ничего, значит и размена там нет.
    const fund = result.get(op.zoneId) ?? 0;
    if (fund > balance) result.set(op.zoneId, Math.max(0, balance));
  }

  return result;
}

/**
 * Сколько владелец забрал из зоны СВЕРХ её остатка с момента `since` — то есть
 * сколько выручки уехало из ящика до того, как сотрудник её пересчитал.
 *
 * Зачем. Владелец приезжает среди дня и забирает кассу, не дожидаясь сдачи
 * итогов. Остаток зоны на этот момент — только то, что осталось от ПРОШЛЫХ
 * сдач: сегодняшняя выручка попадёт в журнал лишь вечером, одной записью.
 * Значит инкассация уводит баланс в минус ровно на сегодняшние деньги, а
 * сотрудник вечером вводит то, что физически осталось в ящике, — без них.
 *
 * Реальный случай КидсБурга 2026-09-02 (жалоба владельца «разницы не
 * реальные»), зона «Батуты»:
 *
 *   16:26  инкассация −305    остаток   0     ← забрал вчерашнее
 *   18:17  инкассация −2000   остаток −2000   ← забрал СЕГОДНЯШНЮЮ выручку
 *   20:02  сдача       +70    остаток −1930   ← сотрудник ввёл, что осталось
 *
 * Счётчики намотали на 3675, касса показала 2135 — «недостача» 1540 из
 * воздуха. Так было пять раз (24.07, 04.08, 05.08, 09.08, 02.09): деньги
 * забирал сам владелец, и каждый раз сотрудник выглядел вором.
 *
 * Это тот же случай, что и расход, оплаченный из ящика: деньги вышли до
 * пересчёта, и для сверки со счётчиками их надо вернуть в выручку. Поэтому
 * число прибавляется и к revenue сдачи (баланс возвращается к тому, что
 * реально в ящике), и к «Разнице».
 *
 * Окно обязательно. Полный отрицательный остаток брать нельзя: минус, не
 * закрытый прошлой сдачей, — это деньги, ПРОШЕДШИЕ МИМО учёта навсегда, и
 * прибавление их к сегодняшней выручке нарисовало бы завтра излишек на
 * вчерашнюю сумму. Считаем прирост дефицита за окно: сколько его было на
 * начало и сколько стало сейчас.
 *
 * Считается по ЛЮБОЙ операции, уводящей остаток в минус, а не только по
 * инкассации: аванс, который сотрудник берёт себе при открытии смены
 * (/api/operator/work-time/shifts), сразу разносится по зонам и точно так же
 * вынимает из ящика деньги, которых вечером уже не будет в пересчёте. Имя
 * поля в сдаче говорит про инкассацию потому, что с неё всё началось, —
 * правило шире.
 */
export async function getZoneCollectionOverdraw(
  zoneIds: string[],
  since: Map<string, Date | null>,
  until: Date,
  client: Tx | typeof prisma = prisma
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!zoneIds.length) return result;

  const ops = await client.moneyOperation.findMany({
    where: { zoneId: { in: zoneIds }, occurredAt: { lt: until } },
    select: { zoneId: true, type: true, amount: true, occurredAt: true },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });

  const balance = new Map<string, number>();
  const deficitAtStart = new Map<string, number>();
  for (const op of ops) {
    if (!op.zoneId || !affectsCashOnHand(op.type)) continue;
    const from = since.get(op.zoneId) ?? null;
    // Дефицит на начало окна фиксируем ровно один раз — на первой операции,
    // которая в окно уже попала.
    if (from && op.occurredAt > from && !deficitAtStart.has(op.zoneId)) {
      deficitAtStart.set(op.zoneId, Math.max(0, -(balance.get(op.zoneId) ?? 0)));
    }
    balance.set(op.zoneId, Math.round(((balance.get(op.zoneId) ?? 0) + Number(op.amount)) * 100) / 100);
  }

  for (const zoneId of zoneIds) {
    const from = since.get(zoneId) ?? null;
    // Окно без единой операции: дефицит начала равен нынешнему, прирост ноль.
    const start = deficitAtStart.get(zoneId) ?? (from ? Math.max(0, -(balance.get(zoneId) ?? 0)) : 0);
    const now = Math.max(0, -(balance.get(zoneId) ?? 0));
    const overdrawn = Math.round(Math.max(0, now - start) * 100) / 100;
    if (overdrawn > 0) result.set(zoneId, overdrawn);
  }
  return result;
}

/** Размен одной зоны — для предложения «оставить размен» при её инкассации. */
export async function getZoneChangeFundInTill(
  zoneId: string,
  client: Tx | typeof prisma = prisma,
  asOf?: Date
): Promise<number> {
  return (await getChangeFundInTillByZone([zoneId], client, asOf)).get(zoneId) ?? 0;
}

/** Весь размен точки: зонный плюс товарный (у товарного своя отсечка — свип). */
export async function getPointChangeFundInTill(
  pointId: string,
  client: Tx | typeof prisma = prisma,
  asOf?: Date
): Promise<number> {
  const upTo = asOf ? { occurredAt: { lt: asOf } } : {};
  const zones = await client.zone.findMany({ where: { pointId }, select: { id: true } });

  const [byZone, goodsOps] = await Promise.all([
    getChangeFundInTillByZone(zones.map((z) => z.id), client, asOf),
    client.moneyOperation.findMany({
      where: {
        pointId,
        type: { in: ["goods_revenue", "goods_change_fund", "collection_pool_sweep_goods"] },
        ...upTo,
      },
      select: { type: true, amount: true },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
  ]);

  let total = 0;
  for (const amount of byZone.values()) total += amount;

  // Товарный размен — тем же проходом с бегущим остатком, что и зонный
  // (getChangeFundInTillByZone): размен лежит в товарной кассе, пока её не
  // забрали, и не может быть больше того, что в ней осталось. Раньше стояла
  // отсечка по свипу — частичная инкассация товарной кассы стирала весь
  // размен, а полная не отличалась от частичной вовсе.
  let goodsBalance = 0;
  let goodsFund = 0;
  for (const op of goodsOps) {
    goodsBalance = Math.round((goodsBalance + Number(op.amount)) * 100) / 100;
    if (op.type === "goods_change_fund") {
      goodsFund = Math.round((goodsFund + Number(op.amount)) * 100) / 100;
    }
    if (goodsFund > goodsBalance) goodsFund = Math.max(0, goodsBalance);
  }
  return Math.round((total + goodsFund) * 100) / 100;
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
// (zoneCollectionCutoff = момент последней zone-level "collection"/
// "advance_settlement") не исключит advance/bonus_payout из своего расчёта,
// и те же деньги вычтутся из остатка точки дважды — один раз зонными
// записями тут, второй раз самой advance-записью.
//
// Тип "advance_settlement", а не "collection" — сознательно (запрос
// пользователя 2026-07-25: "зачем так много строк, пусть будет написано, что
// просто [сотрудник] взял аванс, как обычно"): это автоматическое служебное
// погашение, не факт "кто-то физически инкассировал зону", и не должно
// засорять "Реестр инкассаций" построчной разбивкой по зонам — сам факт
// "аванс/премия взяты" уже виден одной строкой (см. advance_taken/bonus_taken
// в /api/reports/money/collections). getZoneCollectionCutoff выше НАРОЧНО
// продолжает видеть этот тип наравне с "collection" — иначе сломается
// анти-задвоение из абзаца выше.
//
// Целиком в одной транзакции с pg_advisory_xact_lock по pointId (найдено
// аудитом 2026-07-25: два параллельных самостоятельных аванса/премии на одной
// точке — двойной клик или гонка двух операторских сессий — читали остатки
// зон ДО того, как первый вызов успевал их списать, и оба распределяли по
// одним и тем же "старым" весам, реально списывая с зон больше, чем на самом
// деле было взято). Тот же паттерн блокировки, что у nextTicketOrderNumber/
// nextLaunchNumber (src/lib/tickets.ts, src/lib/game-room.ts) — лочимся по
// ключу pointId, а не zoneId, потому что распределяем СРАЗУ по всем зонам
// точки.
//
// amount может быть ОТРИЦАТЕЛЬНЫМ — возврат в зоны (найдено аудитом
// 2026-07-25: PATCH/DELETE .../work-time/shifts/[id] правят или удаляют уже
// разнесённый по зонам аванс/премию, но зонные advance_settlement-записи
// НЕ привязаны к конкретной смене — их нечем найти и скорректировать точечно).
// При уменьшении/удалении вызывающий код передаёт сюда ОТРИЦАТЕЛЬНУЮ дельту —
// зоны получают компенсирующую ПОЛОЖИТЕЛЬНУЮ запись, распределённую по тем же
// текущим весам, что и обычное списание (симметрично, без отдельного учёта
// "с какой именно зоны была взята эта часть аванса раньше" — тот же уровень
// приближения, что и у самого распределения).
export async function chargeSelfServiceAdvanceToZones(
  tenantId: string,
  pointId: string,
  amount: number,
  performedByOperatorId: string,
  // Транзакция вызывающего. Раньше функция ВСЕГДА открывала свою — и между
  // коммитом транзакции, списавшей аванс, и захватом лока здесь точку не
  // держал никто (генеральная проверка финансов 2026-09-02, С19). Инкассация,
  // попавшая в этот зазор, списывала те же деньги внутри poolDeficit, а
  // запоздавшее разнесение списывало их второй раз: зона −300 при пустом
  // ящике. Восстановиться нельзя — после аварии deficit = max(0, 0) = 0, и
  // механизм-фолбэк бессилен.
  //
  // Передавать транзакцию ОБЯЗАТЕЛЬНО, если вызывающий уже держит
  // pg_advisory_xact_lock по этой же точке: лок берётся на транзакцию, а
  // вложенный prisma.$transaction — это другое соединение, и получился бы
  // самодедлок до таймаута.
  client?: Tx
): Promise<void> {
  if (amount === 0) return;

  const run = async (tx: Tx) => {
    // Свой лок берём только когда работаем в собственной транзакции: у
    // вызывающего он уже взят, повторный захват на том же соединении не нужен.
    if (!client) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pointId}))`;

    const zones = await tx.zone.findMany({ where: { pointId }, select: { id: true } });
    if (zones.length === 0) return;

    const zoneIds = zones.map((z) => z.id);
    const balanceByZone = await getZoneBalances(zoneIds, tx);
    const weights = zoneIds.map((id) => balanceByZone.get(id) ?? 0);
    const shares = distributeCollectionWhole(Math.abs(amount), weights);
    const sign = amount > 0 ? -1 : 1;

    const rows = zoneIds
      .map((zoneId, i) => ({
        tenantId,
        zoneId,
        type: "advance_settlement",
        amount: sign * Math.abs(shares[i]),
        performedByOperatorId,
      }))
      .filter((row) => row.amount !== 0);

    if (rows.length > 0) {
      await tx.moneyOperation.createMany({ data: rows });
    }
  };

  if (client) await run(client);
  else await prisma.$transaction(run);
}

// Сколько из остатка кассы точки — продажи абонементов наличными, ещё НЕ
// инкассированные (запрос пользователя 2026-07-18: "выделить абонементные
// деньги из общего pool в свою явную строку" + "инкассация должна работать
// по абсолютно всем наличным деньгам на точке") — своя отсечка, независимая
// от товарной кассы (getPoolSweepCutoff, см. комментарий там же). Только
// НАЛИЧНЫЕ (abonement_topup) — безнал (abonement_topup_cashless) физически
// не в кассе, уже исключён affectsCashOnHand.
export async function getPointAbonementCashTotal(
  pointId: string,
  client: Tx | typeof prisma = prisma
): Promise<number> {
  const ops = await client.moneyOperation.findMany({
    where: { pointId, type: { in: ["abonement_topup", "collection_pool_sweep_abonement"] } },
    select: { amount: true },
  });
  // Пополнения плюс свипы (они отрицательные) — не отсечка по времени.
  // Отсечка списывала пул ЦЕЛИКОМ при инкассации на любую часть его суммы.
  // Ниже нуля пул не опускается: свип больше пула сюда не пройдёт (роут
  // сверяет сумму под локом), а отрицательный остаток означал бы, что
  // забрали денег больше, чем было.
  return Math.max(0, Math.round(ops.reduce((sum, op) => sum + Number(op.amount), 0) * 100) / 100);
}

// Товарные наличные (docs/spec/09-goods.md, "Деньги") — тот же принцип, что
// у getPointAbonementCashTotal выше, но своя, независимая отсечка (см.
// getPoolSweepCutoff) — нужен явной цифрой и для потолка "что честно
// раскладывается по зонам" при инкассации (splitCollectionAmountDetailed), и
// теперь для самого потолка инкассации "Товаров" (запрос пользователя
// 2026-07-25, см. /api/points/[id]/collection/pool). "Размен" по Товарам
// (goods_change_fund, реальные деньги, которые Владелец сам добавил в кассу
// на сдачу — /api/points/[id]/change-fund/goods) тоже учитывается в этой же
// сумме — та же логика, что у зонного "Размена" (change_fund) в getZoneBalances:
// это реальные наличные, физически лежащие в кассе, следующая инкассация
// заберёт их вместе с настоящей выручкой.
export async function getPointGoodsCashTotal(
  pointId: string,
  client: Tx | typeof prisma = prisma
): Promise<number> {
  const ops = await client.moneyOperation.findMany({
    where: { pointId, type: { in: ["goods_revenue", "goods_change_fund", "collection_pool_sweep_goods"] } },
    select: { amount: true },
  });
  // Как и у абонементного пула выше: выручка и размен плюс свипы со своим
  // минусом, вместо отсечки, стиравшей весь пул при частичной инкассации.
  return Math.max(0, Math.round(ops.reduce((sum, op) => sum + Number(op.amount), 0) * 100) / 100);
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
async function computeZonePool(
  pointId: string,
  client: Tx | typeof prisma = prisma
): Promise<{ zoneIds: string[]; weights: number[]; deficit: number }> {
  const zones = await client.zone.findMany({ where: { pointId }, select: { id: true } });
  const zoneIds = zones.map((z) => z.id);
  const [balances, pointTotal, abonementCash, goodsCash] = await Promise.all([
    getZoneBalances(zoneIds, client),
    getPointCashBalance(pointId, client),
    getPointAbonementCashTotal(pointId, client),
    getPointGoodsCashTotal(pointId, client),
  ]);
  const weights = zoneIds.map((id) => balances.get(id) ?? 0);
  const zonesRawSum = weights.reduce((a, b) => a + b, 0);
  // Абонементные и товарные наличные ВЫЧИТАЮТСЯ (генеральная проверка
  // финансов 2026-09-02, С3). Остаток точки включает их наравне с зонными
  // деньгами, поэтому без этих двух слагаемых дефицит схлопывался в ноль, и
  // механизм довзыскания молча выключался: A 600 + B 400, пополнение
  // абонемента 500, аванс 300 → остаток точки 1200, и
  // max(0, 1000 − 1200) = 0 вместо верных 300.
  //
  // Экран «Остатки и инкассации» считал ПРАВИЛЬНО и своей копией формулы, с
  // комментарием, что невычитание товарных денег было реальным багом.
  // Серверный двойник тогда не поправили — классический случай «правку
  // сделали в одном экземпляре». Теперь формула одна, и экран берёт её
  // результат с сервера, а не пересчитывает сам.
  const deficit = Math.max(
    0,
    Math.round((zonesRawSum + abonementCash + goodsCash - pointTotal) * 100) / 100
  );
  return { zoneIds, weights, deficit };
}

// Суммарный пул точки — для общей инкассации: прибавляется к введённой сумме
// перед пропорциональной разбивкой по зонам (distributeCollectionWhole),
// чтобы полная инкассация всех зон реально обнуляла их журнал, а не только
// экран.
export async function getPointPoolDeficit(pointId: string, client: Tx | typeof prisma = prisma): Promise<number> {
  return (await computeZonePool(pointId, client)).deficit;
}

/**
 * Доля пула по КАЖДОЙ зоне — для экрана «Остатки и инкассации».
 *
 * Раньше экран считал это сам, своей копией формулы, и копии разошлись (С3).
 * Теперь число приходит с сервера: одно место правды, и правка формулы больше
 * не может задеть только одну сторону. Величина положительная и означает
 * «столько ещё предстоит списать с зоны» — экран вычитает её из остатка.
 */
export async function getZonePoolAllocation(
  pointId: string,
  client: Tx | typeof prisma = prisma
): Promise<Map<string, number>> {
  const { zoneIds, weights, deficit } = await computeZonePool(pointId, client);
  const result = new Map<string, number>();
  if (deficit === 0) return result;
  const shares = distributeCollectionWhole(deficit, weights);
  zoneIds.forEach((id, i) => {
    if (shares[i]) result.set(id, shares[i]);
  });
  return result;
}

// Доля пула конкретной зоны — для инкассации ОДНОЙ зоны: та же пропорция,
// что и в общей разбивке, но нужна только сумма для этой зоны.
export async function getZonePoolShare(
  pointId: string,
  zoneId: string,
  client: Tx | typeof prisma = prisma
): Promise<number> {
  const { zoneIds, weights, deficit } = await computeZonePool(pointId, client);
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
export async function getOutstandingCollectionAdvance(
  pointId: string,
  client: Tx | typeof prisma = prisma
): Promise<number> {
  const ops = await client.moneyOperation.findMany({
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
// появились — вызывается ПЕРВЫМ шагом в каждом из /api/zones/[id]/collection,
// /api/points/[id]/collection/general и их operator-аналогов, до расчёта
// самой новой инкассации: свежие остатки зон после гашения используются
// дальше как основа для splitCollectionAmountDetailed новой суммы. Также
// вызывается автоматически из /api/operator/submit-results сразу после
// сохранения выручки (запрос пользователя 2026-07-25: "почему не вычесть эти
// 700 и остаток оставить в зонах, чтобы я видел реальные цифры и авансовая
// инкассация гасилась" — раньше гашение происходило только на СЛЕДУЮЩЕЙ
// инкассации, владелец мог долго видеть неактуальный "Аванс инкассации" и
// заниженные остатки зон, хотя Сотрудник уже сдал покрывающую выручку).
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
//
// Тип зонных записей — "advance_settlement", не "collection" (запрос
// пользователя 2026-07-25, тот же принцип, что у chargeSelfServiceAdvanceToZones
// выше): это автоматическое служебное погашение, не факт "владелец пришёл и
// инкассировал", городить по строке на каждую зону в "Реестре инкассаций"
// только шумит — сам факт "Аванс инкассации" уже виден одной строкой.
//
// Целиком в одной транзакции с pg_advisory_xact_lock по pointId (найдено
// аудитом 2026-07-25: эта функция вызывается из НЕСКОЛЬКИХ мест — вручную из
// каждого роута инкассации И автоматически из /api/operator/submit-results —
// два почти одновременных триггера на одной точке, например двойной клик
// "Сдать итоги" или Сдача итогов, совпавшая по времени с ручной инкассацией,
// читали один и тот же getOutstandingCollectionAdvance ДО того, как первый
// вызов успевал его погасить, и оба списывали одну и ту же сумму с зон
// дважды). Тот же паттерн блокировки, что у chargeSelfServiceAdvanceToZones
// выше и nextTicketOrderNumber/nextLaunchNumber.
export async function settleOutstandingCollectionAdvance(
  tenantId: string,
  pointId: string,
  actor: CollectionActor,
  // Опционально — только вызов из submit-results передаёт (аудит 2026-07-27,
  // реальный денежный баг): без этой метки строки advance_settlement/
  // collection_advance, созданные АВТОМАТИЧЕСКИ сразу после Сдачи итогов,
  // были никак не связаны с породившей их сдачей. Владелец мог удалить/
  // отредактировать эту (последнюю в цепочке, ещё редактируемую) сдачу через
  // /api/reports/submissions/zone-submission/[id] — тот роут откатывает только
  // MoneyOperation с совпадающим resultsSubmissionId, поэтому откатывал
  // revenue-строку, но НЕ трогал уже созданное автопогашение аванса — реальные
  // деньги тихо и безвозвратно пропадали из учёта (аванс считался погашенным,
  // хотя выручка, которой он был погашен, только что удалена). Ручные вызовы
  // (owner/operator "Инкассация") не передают этот параметр — их нечего
  // реверсировать, они не создаются автоматически внутри сдачи итогов.
  resultsSubmissionId?: string
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pointId}))`;

    const outstanding = await getOutstandingCollectionAdvance(pointId, tx);
    if (outstanding <= 0) return 0;

    const zones = await tx.zone.findMany({ where: { pointId }, select: { id: true } });
    const zoneIds = zones.map((z) => z.id);
    if (zoneIds.length === 0) return 0;

    const balances = await getZoneBalances(zoneIds, tx);
    const weights = zoneIds.map((id) => balances.get(id) ?? 0);
    const zonesRawSum = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    const settleable = Math.round(Math.min(outstanding, zonesRawSum) * 100) / 100;
    if (settleable <= 0) return 0;

    // Адресат погашения — ради отката правки/удаления самой инкассации
    // (schema.prisma, MoneyOperation.settlesOperationId). Ставим связь только
    // когда непогашенная авансовая инкассация ровно одна: тогда очевидно, что
    // всё это погашение относится к ней. Если их несколько, делить погашение
    // между ними здесь было бы гаданием — оставляем null, а правку таких строк
    // эндпоинт отклоняет явно.
    //
    // "Погашена" считается ПО ДЕНЬГАМ, а не по наличию ссылки (найдено на
    // проде КидсБурга 2026-08-22). Раньше закрытыми признавались только те
    // авансы, на которые кто-то ссылается, — но погашение без ссылки (а его
    // и создаёт эта же ветка, когда открытых авансов больше одного) никого не
    // закрывало. Один такой случай — и дальше открытыми числятся ВСЕ авансы
    // точки за всю историю, включая давно погашенные: связь больше никогда не
    // проставляется, а /api/money/collections/[id] отвечает на правку
    // "погашение не связано со строкой". Самоподдерживающийся тупик: владелец
    // навсегда терял возможность исправить ошибочную сумму инкассации.
    // Гасим по FIFO — в порядке возникновения долга, как их и гасит жизнь.
    const advanceOps = await tx.moneyOperation.findMany({
      where: { pointId, type: "collection_advance" },
      select: { id: true, amount: true },
      orderBy: { occurredAt: "asc" },
    });
    const debts: { id: string; left: number }[] = [];
    for (const op of advanceOps) {
      const amount = Number(op.amount);
      if (amount < 0) {
        debts.push({ id: op.id, left: -amount });
        continue;
      }
      let repay = amount;
      for (const debt of debts) {
        if (repay <= 0) break;
        const covered = Math.min(debt.left, repay);
        debt.left = Math.round((debt.left - covered) * 100) / 100;
        repay = Math.round((repay - covered) * 100) / 100;
      }
    }
    const open = debts.filter((debt) => debt.left > 0);
    const settlesOperationId = open.length === 1 ? open[0].id : null;

    const shares = distributeCollectionWhole(settleable, weights);
    const rows = zoneIds
      .map((zoneId, i) => ({
        tenantId,
        zoneId,
        type: "advance_settlement",
        amount: -Math.abs(shares[i]),
        performedByUserId: actor.performedByUserId,
        performedByOperatorId: actor.performedByOperatorId,
        resultsSubmissionId: resultsSubmissionId ?? null,
        settlesOperationId,
      }))
      .filter((row) => row.amount !== 0);

    if (rows.length > 0) await tx.moneyOperation.createMany({ data: rows });

    await tx.moneyOperation.create({
      data: {
        tenantId,
        pointId,
        type: "collection_advance",
        amount: settleable,
        performedByUserId: actor.performedByUserId,
        performedByOperatorId: actor.performedByOperatorId,
        resultsSubmissionId: resultsSubmissionId ?? null,
        settlesOperationId,
      },
    });

    return settleable;
  });
}

/**
 * Можно ли править/удалять эту "Авансовую инкассацию" — и если нет, почему.
 * Вызывается эндпоинтом реестра до правки (2026-08-14).
 *
 * Правка суммы обычной инкассации ничего не ломает: остатки зон считаются
 * суммой всего журнала заново, а отсечки зависят от даты, не от суммы. Но у
 * авансовой инкассации есть автопогашение (settleOutstandingCollectionAdvance
 * выше), которое списало часть с зон отдельными строками. Не снять их вместе с
 * исходной строкой — оставить зоны занижёнными навсегда.
 *
 * Три исхода:
 * - "ok" — гасить нечего либо погашающие строки найдены и будут сняты;
 * - "machine" — это сама строка погашения, а не инкассация владельца: править
 *   её руками нельзя (PATCH к тому же принудительно делает сумму
 *   отрицательной, что перевернуло бы знак компенсации);
 * - "settled_unlinked" — строку погасили, но связь не сохранена: погашения до
 *   миграции 2026-08-14 (бэкфила нет) и редчайший случай двух непогашенных
 *   инкассаций сразу. Гадать, какую часть погашения снимать, хуже, чем отказать.
 */
export async function checkCollectionAdvanceEditable(
  op: { id: string; type: string; amount: Prisma.Decimal | number; pointId: string | null; occurredAt: Date; settlesOperationId: string | null },
  client: Tx | typeof prisma = prisma
): Promise<"ok" | "machine" | "settled_unlinked"> {
  if (op.type !== "collection_advance") return "ok";
  if (op.settlesOperationId || Number(op.amount) > 0) return "machine";
  if (!op.pointId) return "ok";

  const linked = await client.moneyOperation.count({ where: { settlesOperationId: op.id } });
  if (linked > 0) return "ok";

  // Погашение без связи, случившееся ПОСЛЕ этой инкассации, могло погасить
  // именно её. Более раннее — точно не могло (её тогда ещё не существовало),
  // и новая инкассация на точке со старым погашением правится свободно.
  const laterUnlinked = await client.moneyOperation.count({
    where: {
      pointId: op.pointId,
      type: "collection_advance",
      amount: { gt: 0 },
      settlesOperationId: null,
      occurredAt: { gt: op.occurredAt },
    },
  });
  return laterUnlinked > 0 ? "settled_unlinked" : "ok";
}

/**
 * Снимает автопогашение конкретной "Авансовой инкассации" — и зонные
 * advance_settlement, и компенсирующую collection_advance. Вызывать в той же
 * транзакции, что правку/удаление самой строки, под advisory-локом точки:
 * иначе одновременная сдача итогов успеет погасить её заново по данным,
 * которых через миг не станет.
 *
 * Дальше ничего пересчитывать не надо: непогашенный остаток аванса считается
 * из истории заново (getOutstandingCollectionAdvance), и следующая сдача или
 * инкассация погасит его уже от новой суммы.
 */
export async function reverseCollectionAdvanceSettlement(tx: Tx, advanceOperationId: string): Promise<void> {
  await tx.moneyOperation.deleteMany({ where: { settlesOperationId: advanceOperationId } });
}

// Откат автопогашения "Аванса инкассации", привязанного к конкретной Сдаче
// итогов (аудит 2026-07-27 — см. комментарий у resultsSubmissionId выше).
// Удаляет ВСЕ advance_settlement/collection_advance строки этой сдачи, не
// только по одной зоне — settleOutstandingCollectionAdvance вызывается ОДИН
// раз на всю точку сразу после сдачи и распределяет погашение по всем зонам
// точки пропорционально их балансу в тот момент; если владелец удаляет/
// правит хотя бы одну зону из этой сдачи, входные данные того расчёта уже не
// действительны — безопаснее полностью откатить весь автоматический эффект
// (аванс снова считается непогашенным) и дать ему естественно
// пересчитаться на следующей сдаче/инкассации, чем пытаться пересчитать его
// частично здесь же. Вызывающая сторона сама решает, в той же транзакции
// или нет — здесь только удаление, без advisory-lock: гонки нет, потому что
// вызывается изнутри уже залоченной транзакции удаления/правки самой сдачи.
// Условие это до 2026-09-02 держалось на честном слове — ни PATCH, ни DELETE
// в /api/reports/submissions/zone-submission/[id] лока не брали вовсе. Теперь
// берут; при добавлении нового вызывающего лок обязателен.
export async function reverseResultsSubmissionAdvanceSettlement(
  tx: Tx,
  resultsSubmissionId: string
): Promise<void> {
  await tx.moneyOperation.deleteMany({
    where: { resultsSubmissionId, type: { in: ["advance_settlement", "collection_advance"] } },
  });
}
