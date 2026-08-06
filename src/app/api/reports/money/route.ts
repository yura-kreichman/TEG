import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantDayContext } from "@/lib/tenant-day";
import { requireOwner } from "@/lib/require-owner";
import {
  computeZoneSubmissionRevenues,
  getPeriodRange,
  isPeriodGranularity,
  parseDateParam,
  type PeriodGranularity,
} from "@/lib/reports";
import { businessDayOf, parseBoundary, zonedWallTimeToUtc } from "@/lib/business-day";
import {
  affectsCashOnHand,
  getOutstandingCollectionAdvance,
  getPointAbonementCashTotal,
  getPointCashBalance,
  getPointGoodsCashTotal,
} from "@/lib/zone-balance";
import { getTenantModuleFlags } from "@/lib/tenant-modules";

// "Бизнес: расходы и прибыль" (за выбранный период) и текущий остаток "сколько
// наличных должно быть на точке" (docs/spec/02-money.md, всегда весь журнал —
// это текущее состояние кассы, а не показатель за период) — оба считаются из
// единого журнала MoneyOperation, без отдельного хранения остатков.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const today = new Date();
  // Часовой пояс тенанта (аудит 2026-07-25, повторная проверка) — границы
  // периода должны совпадать с местным календарным днём владельца, не с
  // сырым UTC сервера, см. комментарий у getPeriodRange в lib/reports.ts.
  const { timezone, boundary } = await getTenantDayContext(owner.tenantId);
  const { hours: bh, minutes: bm } = parseBoundary(boundary);
  const todayLocal = businessDayOf(today, timezone, boundary);
  const todayNext = new Date(Date.UTC(todayLocal.year, todayLocal.month - 1, todayLocal.day + 1));
  const todayEnd = zonedWallTimeToUtc(
    todayNext.getUTCFullYear(),
    todayNext.getUTCMonth() + 1,
    todayNext.getUTCDate(),
    0,
    0,
    timezone
  );

  // Свой диапазон (from/to) — отдельная ветка от granularity/anchor: владелец
  // выбирает произвольные даты вместо готового периода. Конец диапазона
  // включительно на клиенте, здесь переводим в exclusive-границу и так же
  // обрезаем будущим — как и у остальных периодов.
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const fromParts = fromParam ? parseDateParam(fromParam) : null;
  const toParts = toParam ? parseDateParam(toParam) : null;
  let start: Date;
  let end: Date;
  let granularity: PeriodGranularity | "custom";
  if (fromParts && toParts) {
    granularity = "custom";
    start = zonedWallTimeToUtc(fromParts.year, fromParts.month, fromParts.day, bh, bm, timezone);
    const nextDay = new Date(Date.UTC(toParts.year, toParts.month - 1, toParts.day + 1));
    end = zonedWallTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 0, 0, timezone);
    if (end > todayEnd) end = todayEnd;
    if (start > end) start = end;
  } else {
    const granularityParam = searchParams.get("granularity");
    granularity = isPeriodGranularity(granularityParam) ? granularityParam : "month";
    const anchorParam = searchParams.get("anchor");
    const anchorParts = anchorParam ? parseDateParam(anchorParam) : null;
    const anchor = anchorParts
      ? zonedWallTimeToUtc(anchorParts.year, anchorParts.month, anchorParts.day, 12, 0, timezone)
      : today;
    ({ start, end } = getPeriodRange(granularity, anchor, today, timezone, boundary));
  }

  // Фильтр по точке — опциональный (запрос пользователя 2026-07-16: "по
  // умолчанию все точки"), отдельный параметр поверх period/granularity,
  // не завязан на них. Без него страница остаётся тем, чем была изначально —
  // сводкой по всему бизнесу тенанта сразу.
  const pointIdParam = searchParams.get("pointId");

  const [zones, points] = await Promise.all([
    prisma.zone.findMany({
      where: { point: { tenantId: owner.tenantId, ...(pointIdParam ? { id: pointIdParam } : {}) } },
      include: { point: true },
      orderBy: [{ point: { createdAt: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.point.findMany({
      where: { tenantId: owner.tenantId, ...(pointIdParam ? { id: pointIdParam } : {}) },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const operations = await prisma.moneyOperation.findMany({
    where: {
      tenantId: owner.tenantId,
      ...(pointIdParam ? { OR: [{ zone: { pointId: pointIdParam } }, { pointId: pointIdParam }] } : {}),
    },
  });

  const balanceByZone = new Map<string, number>();
  let totalRevenueCash = 0;
  let totalRevenueMobile = 0;
  let totalExpense = 0;
  let totalPayouts = 0;

  for (const op of operations) {
    const amount = Number(op.amount);
    // Остаток по зоне — текущее состояние физической кассы, весь журнал, без
    // периода. Типы из CASH_EXCLUDED_TYPES (zone-balance.ts) сюда не входят —
    // безнал/абонементные пополнение-безналом/трата не лежат в кассе
    // физически (docs/spec/02-money.md). Остаток по точке в целом (с учётом
    // аванса/премии) считается отдельно через getPointCashBalance ниже —
    // там же учитывается более сложное правило (кто внёс + с какого момента
    // после инкассации), не подходящее для простого прохода по зонам здесь.
    if (affectsCashOnHand(op.type) && op.zoneId) {
      balanceByZone.set(op.zoneId, (balanceByZone.get(op.zoneId) ?? 0) + amount);
    }

    if (op.occurredAt < start || op.occurredAt >= end) continue;
    // "Выручка" бизнес-карточки — наличная И безналичная (найдено аудитом
    // 2026-07-12: раньше безнал не журналировался вовсе, выручка занижалась
    // на его сумму); разбивка по способу оплаты видна отдельно (запрос
    // пользователя 2026-07-15: "не видна разбивка по наличным и безналичным").
    if (op.type === "revenue") totalRevenueCash += amount;
    if (op.type === "revenue_cashless") totalRevenueMobile += amount;
    // Товары (docs/spec/09-goods.md: "не отдельный бизнес") — сливаются в те
    // же три суммы, что и зонная выручка выше, а не отдельная строка —
    // "Бизнес: расходы и прибыль" остаётся единой цифрой по всей точке.
    if (op.type === "goods_revenue") totalRevenueCash += amount;
    if (op.type === "goods_revenue_cashless") totalRevenueMobile += amount;
    // Абонементы (пересмотрено 2026-07-25 дважды — сперва отдельной строкой
    // "Баланс", это оказалось ошибкой: та же иконка/подпись, что везде
    // означает "клиент заплатил СО своего баланса" — а тут наоборот деньги
    // ЗА пополнение, реальные наличные/безнал. Слито в общие суммы, тем же
    // принципом, что и Товары выше ("не отдельный бизнес") — по факту
    // способа оплаты пополнения, без отдельной вводящей в заблуждение
    // строки. revenue_abonement/goods_revenue_abonement (трата) по-прежнему
    // не входят вовсе — деньги уже учтены в момент пополнения.
    if (op.type === "abonement_topup") totalRevenueCash += amount;
    if (op.type === "abonement_topup_cashless") totalRevenueMobile += amount;
    if (op.type === "expense") totalExpense += amount;
    // Зарплаты (пересмотрено 2026-07-25 — решение 2026-07-14 "авансы/премии
    // не расход бизнеса" создало расхождение с Отчётами → Динамика, где
    // profitAndLoss.profit их ВСЕГДА вычитал: та же Прибыль на разных
    // экранах показывала разные числа. Авансы/премии — реальные деньги,
    // физически покинувшие кассу, значит настоящий расход бизнеса — теперь
    // вычитаются и здесь, отдельной строкой "Зарплаты" рядом с Расходами
    // (не слиты в expense, чтобы не терять разбивку "закупки" vs "ФОТ").
    if (op.type === "advance" || op.type === "bonus_payout") totalPayouts += amount;
  }

  // Разница (недостача/излишек) бизнес-карточки — сумма "факт минус расчёт
  // по счётчику" по всем сдачам периода (запрос пользователя 2026-07-14).
  // Только зоны "По счётчикам"/"По пускам" — у "Только касса" нет счётчика,
  // с которым сверяться, calculatedRevenue там был бы всегда 0, и вся её
  // выручка ложно выглядела бы как 100% расхождение.
  const reconcilableZoneIds = zones.filter((z) => z.accountingMode !== "cash_only").map((z) => z.id);
  const revenueEntries = await computeZoneSubmissionRevenues(reconcilableZoneIds, start, end);
  const totalDifference = revenueEntries.reduce((sum, e) => sum + e.difference, 0);
  const totalReturns = revenueEntries.reduce((sum, e) => sum + e.returnsCount, 0);

  const zoneBalances = zones.map((zone) => ({
    zoneId: zone.id,
    zoneName: zone.name,
    zoneIconKey: zone.iconKey,
    pointId: zone.pointId,
    pointName: zone.point.name,
    balance: Math.round((balanceByZone.get(zone.id) ?? 0) * 100) / 100,
  }));

  // Остаток по точке в целом — единый расчёт с getPointCashBalance
  // (lib/zone-balance.ts), чтобы не дублировать правило "кто внёс аванс/
  // премию + с какого момента после инкассации" в двух местах.
  const pointTotals = await Promise.all(
    points.map(async (point) => {
      const [total, abonementCashTotal, goodsCashTotal, collectionAdvance] = await Promise.all([
        getPointCashBalance(point.id),
        getPointAbonementCashTotal(point.id),
        getPointGoodsCashTotal(point.id),
        // "Аванс инкассации" (lib/zone-balance.ts) — забрано физически, но
        // ещё не разнесено по зонам (запрос пользователя 2026-07-22) —
        // отдельная строка на экране, своя транзакция, не в getPointCashBalance
        // (там она намеренно исключена, см. CASH_EXCLUDED_TYPES).
        getOutstandingCollectionAdvance(point.id),
      ]);
      return {
        pointId: point.id,
        pointName: point.name,
        total: Math.round(total * 100) / 100,
        abonementCashTotal: Math.round(abonementCashTotal * 100) / 100,
        goodsCashTotal: Math.round(goodsCashTotal * 100) / 100,
        collectionAdvance: Math.round(collectionAdvance * 100) / 100,
      };
    })
  );

  // Модули тенанта (запрос пользователя 2026-07-25: "в верхней плашке... если
  // Владелец использует эти модули") — строки "Абонементы"/"Товары" на
  // экране должны быть видны всегда, пока модуль включён, а не только когда
  // в них случайно оказалась ненулевая сумма (тот же принцип, что уже
  // применён к самим зонам — они тоже показываются и при 0 ₽).
  const { goodsEnabled, clientsEnabled } = await getTenantModuleFlags(owner.tenantId);

  return NextResponse.json({
    zoneBalances,
    pointTotals,
    goodsEnabled,
    clientsEnabled,
    // Название точки в группировке имеет смысл, только если точек больше
    // одной (запрос пользователя 2026-07-14 — и так ясно, если она одна).
    showPointName: points.length > 1,
    period: { granularity, start: start.toISOString(), end: end.toISOString() },
    business: {
      revenue: Math.round((totalRevenueCash + totalRevenueMobile) * 100) / 100,
      cash: Math.round(totalRevenueCash * 100) / 100,
      mobile: Math.round(totalRevenueMobile * 100) / 100,
      expense: Math.round(totalExpense * 100) / 100,
      salary: Math.round(totalPayouts * 100) / 100,
      profit: Math.round((totalRevenueCash + totalRevenueMobile + totalExpense + totalPayouts) * 100) / 100,
      difference: Math.round(totalDifference * 100) / 100,
      returnsCount: totalReturns,
    },
  });
}
