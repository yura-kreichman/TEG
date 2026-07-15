import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { computeZoneSubmissionRevenues, getPeriodRange, isPeriodGranularity, type PeriodGranularity } from "@/lib/reports";
import { getPointCashBalance } from "@/lib/zone-balance";

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
  const todayEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));

  // Свой диапазон (from/to) — отдельная ветка от granularity/anchor: владелец
  // выбирает произвольные даты вместо готового периода. Конец диапазона
  // включительно на клиенте, здесь переводим в exclusive-границу и так же
  // обрезаем будущим — как и у остальных периодов.
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  let start: Date;
  let end: Date;
  let granularity: PeriodGranularity | "custom";
  if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    granularity = "custom";
    start = new Date(`${fromParam}T00:00:00.000Z`);
    const toDate = new Date(`${toParam}T00:00:00.000Z`);
    end = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    if (end > todayEnd) end = todayEnd;
    if (start > end) start = end;
  } else {
    const granularityParam = searchParams.get("granularity");
    granularity = isPeriodGranularity(granularityParam) ? granularityParam : "month";
    const anchorParam = searchParams.get("anchor");
    const anchor =
      anchorParam && /^\d{4}-\d{2}-\d{2}$/.test(anchorParam) ? new Date(`${anchorParam}T00:00:00.000Z`) : new Date();
    ({ start, end } = getPeriodRange(granularity, anchor, today));
  }

  const [zones, points] = await Promise.all([
    prisma.zone.findMany({
      where: { point: { tenantId: owner.tenantId } },
      include: { point: true },
      orderBy: [{ point: { createdAt: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.point.findMany({ where: { tenantId: owner.tenantId }, orderBy: { createdAt: "asc" } }),
  ]);

  const operations = await prisma.moneyOperation.findMany({
    where: { tenantId: owner.tenantId },
  });

  const balanceByZone = new Map<string, number>();
  let totalRevenueCash = 0;
  let totalRevenueMobile = 0;
  let totalExpense = 0;

  for (const op of operations) {
    const amount = Number(op.amount);
    // Остаток по зоне — текущее состояние физической кассы, весь журнал, без
    // периода. revenue_cashless сюда не входит — безнал не лежит в кассе
    // физически (docs/spec/02-money.md). Остаток по точке в целом (с учётом
    // аванса/премии) считается отдельно через getPointCashBalance ниже —
    // там же учитывается более сложное правило (кто внёс + с какого момента
    // после инкассации), не подходящее для простого прохода по зонам здесь.
    if (op.type !== "revenue_cashless" && op.zoneId) {
      balanceByZone.set(op.zoneId, (balanceByZone.get(op.zoneId) ?? 0) + amount);
    }

    if (op.occurredAt < start || op.occurredAt >= end) continue;
    // "Выручка" бизнес-карточки — наличная И безналичная (найдено аудитом
    // 2026-07-12: раньше безнал не журналировался вовсе, выручка занижалась
    // на его сумму); разбивка по способу оплаты видна отдельно (запрос
    // пользователя 2026-07-15: "не видна разбивка по наличным и безналичным").
    if (op.type === "revenue") totalRevenueCash += amount;
    if (op.type === "revenue_cashless") totalRevenueMobile += amount;
    // Расходы бизнес-карточки — только обычные expense (запрос пользователя
    // 2026-07-14: авансы/премии больше не считаются здесь расходом — это
    // выплата уже заработанного персоналу, не трата бизнеса; отдельно видны
    // в /money/advances-bonuses).
    if (op.type === "expense") totalExpense += amount;
  }

  // Разница (недостача/излишек) бизнес-карточки — сумма "факт минус расчёт
  // по счётчику" по всем сдачам периода (запрос пользователя 2026-07-14).
  // Только зоны "По счётчикам"/"По пускам" — у "Только касса" нет счётчика,
  // с которым сверяться, calculatedRevenue там был бы всегда 0, и вся её
  // выручка ложно выглядела бы как 100% расхождение.
  const reconcilableZoneIds = zones.filter((z) => z.accountingMode !== "cash_only").map((z) => z.id);
  const revenueEntries = await computeZoneSubmissionRevenues(reconcilableZoneIds, start, end);
  const totalDifference = revenueEntries.reduce((sum, e) => sum + e.difference, 0);

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
    points.map(async (point) => ({
      pointId: point.id,
      pointName: point.name,
      total: Math.round((await getPointCashBalance(point.id)) * 100) / 100,
    }))
  );

  return NextResponse.json({
    zoneBalances,
    pointTotals,
    // Название точки в группировке имеет смысл, только если точек больше
    // одной (запрос пользователя 2026-07-14 — и так ясно, если она одна).
    showPointName: points.length > 1,
    period: { granularity, start: start.toISOString(), end: end.toISOString() },
    business: {
      revenue: Math.round((totalRevenueCash + totalRevenueMobile) * 100) / 100,
      cash: Math.round(totalRevenueCash * 100) / 100,
      mobile: Math.round(totalRevenueMobile * 100) / 100,
      expense: Math.round(totalExpense * 100) / 100,
      profit: Math.round((totalRevenueCash + totalRevenueMobile + totalExpense) * 100) / 100,
      difference: Math.round(totalDifference * 100) / 100,
    },
  });
}
