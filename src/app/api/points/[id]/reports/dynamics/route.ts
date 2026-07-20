import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import {
  computeZoneSubmissionRevenues,
  getPreviousCustomRange,
  getPreviousPeriodRange,
  resolvePeriodFromParams,
  round2,
} from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/dynamics">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  // "all" — псевдо-ID для опции "Все точки" в дропдауне (запрос пользователя
  // 2026-07-16): агрегация по всему тенанту вместо одной точки, тот же
  // приём, что уже был на /money (там — просто отсутствие pointId вовсе,
  // здесь — отдельный URL-сегмент, т.к. маршрут /reports/[pointId] требует id).
  const { id: pointId } = await ctx.params;
  const isAllPoints = pointId === "all";
  let pointName: string | null = null;
  if (!isAllPoints) {
    const point = await findTenantPoint(owner.tenantId, pointId);
    if (!point) {
      return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
    }
    pointName = point.name;
  }

  const { searchParams } = new URL(request.url);
  const today = new Date();
  const { start, end, granularity, isCustom } = resolvePeriodFromParams(searchParams, today);
  const { start: prevStart, end: prevEnd } = isCustom
    ? getPreviousCustomRange(start, end)
    : getPreviousPeriodRange(granularity, start);

  const zones = await prisma.zone.findMany({
    where: isAllPoints ? { point: { tenantId: owner.tenantId } } : { pointId },
    select: { id: true },
  });
  const zoneIds = zones.map((z) => z.id);

  const entries = await computeZoneSubmissionRevenues(zoneIds, start, end);

  let totalCash = 0;
  let totalMobile = 0;
  const byDay = new Map<string, number>();
  for (const e of entries) {
    totalCash += e.actualCash;
    totalMobile += e.actualMobile;
  }

  const submissions = zoneIds.length
    ? await prisma.zoneSubmission.findMany({
        where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: start, lt: end } } },
        select: { cashAmount: true, mobileAmount: true, resultsSubmission: { select: { id: true, submittedAt: true } } },
      })
    : [];
  const submissionIds = new Set<string>();
  // Дни/месяцы, где реально что-то произошло (сдача итогов, абонемент,
  // расход/аванс/премия) — запрос пользователя 2026-07-18: "на графике не
  // нужно отображать день, когда не было сдачи итогов, как сегодня" — линия
  // не должна тянуться через дни без единого события, включая сегодняшний
  // ещё не сданный день.
  const activeDays = new Set<string>();
  for (const s of submissions) {
    submissionIds.add(s.resultsSubmission.id);
    const dayKey = s.resultsSubmission.submittedAt.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + Number(s.cashAmount) + Number(s.mobileAmount));
    activeDays.add(dayKey);
  }

  const moneyOps = await prisma.moneyOperation.findMany({
    where: {
      tenantId: owner.tenantId,
      occurredAt: { gte: start, lt: end },
      ...(isAllPoints ? {} : { OR: [{ zone: { pointId } }, { pointId }] }),
    },
    select: { type: true, amount: true, occurredAt: true },
  });
  let expenses = 0;
  let payouts = 0;
  // Продажи абонементов за период — информационно, отдельно от total/profit
  // (запрос пользователя 2026-07-18): это аванс клиента, не заработанная
  // выручка, поэтому не участвует в сумме ниже, в отличие от revenue_abonement.
  let abonementSoldCash = 0;
  let abonementSoldMobile = 0;
  // Абонемент — "Выручка" признаётся в момент траты (revenue_abonement), не
  // пополнения; касса точки эти деньги сейчас не получает (уже получила
  // раньше, при пополнении), поэтому её нет в cashAmount/mobileAmount выше,
  // но она реальная выручка бизнеса и должна попадать в total/profit ниже —
  // тот же разрыв, что уже был найден и исправлен в daily-cash-data.ts/
  // counters/day/route.ts (запрос пользователя 2026-07-17/18: "во всех
  // отчётах и сводках должны быть правильные цифры"), тут был пропущен.
  let totalAbonement = 0;
  // Товары (docs/spec/09-goods.md, "Отчётность и размещение": "товары —
  // равноправный слой стека рядом с зонами") — та же логика, что revenue_abonement
  // выше: гросс-выручка (все три способа оплаты), прибавляется к total/byDay,
  // визуально график линейный (не столбчатый), отдельного слоя не рисует —
  // "равноправный" здесь означает "в тех же суммах", как и было с абонементом.
  let totalGoods = 0;
  // По дням — для линии "Прибыль" на графике (запрос пользователя 2026-07-16:
  // "и Выручку, и Прибыль двумя разными цветами"), тот же принцип, что byDay
  // для выручки выше.
  const deductionsByDay = new Map<string, number>();
  for (const op of moneyOps) {
    const amount = Math.abs(Number(op.amount));
    if (op.type === "expense") expenses += amount;
    if (op.type === "advance" || op.type === "bonus_payout") payouts += amount;
    if (op.type === "expense" || op.type === "advance" || op.type === "bonus_payout") {
      const key = op.occurredAt.toISOString().slice(0, 10);
      deductionsByDay.set(key, (deductionsByDay.get(key) ?? 0) + amount);
      activeDays.add(key);
    }
    if (op.type === "revenue_abonement") {
      totalAbonement += amount;
      const key = op.occurredAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + amount);
      activeDays.add(key);
    }
    if (op.type === "abonement_topup") abonementSoldCash += amount;
    if (op.type === "abonement_topup_cashless") abonementSoldMobile += amount;
    if (op.type === "goods_revenue" || op.type === "goods_revenue_cashless" || op.type === "goods_revenue_abonement") {
      // Знаковая сумма, НЕ Math.abs(amount) выше — аннулирование продажи
      // (voidGoodsSale, src/lib/goods.ts) пишет компенсирующую операцию с
      // ОТРИЦАТЕЛЬНОЙ суммой того же типа, она должна вычесть из выручки,
      // а не снова прибавиться по модулю.
      const signedAmount = Number(op.amount);
      totalGoods += signedAmount;
      const key = op.occurredAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + signedAmount);
      activeDays.add(key);
    }
  }

  // Previous period: only need the actual total for the delta%, no chain-walk needed.
  const [prevSubmissions, prevAbonementOps, prevGoodsOps] = await Promise.all([
    zoneIds.length
      ? prisma.zoneSubmission.findMany({
          where: { zoneId: { in: zoneIds }, resultsSubmission: { submittedAt: { gte: prevStart, lt: prevEnd } } },
          select: { cashAmount: true, mobileAmount: true },
        })
      : Promise.resolve([]),
    prisma.moneyOperation.findMany({
      where: {
        tenantId: owner.tenantId,
        type: "revenue_abonement",
        occurredAt: { gte: prevStart, lt: prevEnd },
        ...(isAllPoints ? {} : { OR: [{ zone: { pointId } }, { pointId }] }),
      },
      select: { amount: true },
    }),
    prisma.moneyOperation.findMany({
      where: {
        tenantId: owner.tenantId,
        type: { in: ["goods_revenue", "goods_revenue_cashless", "goods_revenue_abonement"] },
        occurredAt: { gte: prevStart, lt: prevEnd },
        ...(isAllPoints ? {} : { OR: [{ zone: { pointId } }, { pointId }] }),
      },
      select: { amount: true },
    }),
  ]);
  const prevTotal =
    prevSubmissions.reduce((sum, s) => sum + Number(s.cashAmount) + Number(s.mobileAmount), 0) +
    prevAbonementOps.reduce((sum, op) => sum + Math.abs(Number(op.amount)), 0) +
    // Знаковая сумма — тот же принцип, что и totalGoods выше.
    prevGoodsOps.reduce((sum, op) => sum + Number(op.amount), 0);

  const total = totalCash + totalMobile + totalAbonement + totalGoods;
  const deltaPercent = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null;

  // За год — 365 ежедневных столбцов на графике нечитаемы, агрегируем по
  // месяцам (12 столбцов), как и с "Неделя"/"Месяц" — по дням.
  const bars: { date: string; total: number; profit: number; hasData: boolean }[] = [];
  if (granularity === "year") {
    const byMonth = new Map<string, number>();
    const deductionsByMonth = new Map<string, number>();
    const activeMonths = new Set<string>();
    for (const [dayKey, value] of byDay) {
      const monthKey = dayKey.slice(0, 7);
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + value);
    }
    for (const [dayKey, value] of deductionsByDay) {
      const monthKey = dayKey.slice(0, 7);
      deductionsByMonth.set(monthKey, (deductionsByMonth.get(monthKey) ?? 0) + value);
    }
    for (const dayKey of activeDays) activeMonths.add(dayKey.slice(0, 7));
    for (let m = new Date(start); m < end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
      const revenueForBar = byMonth.get(key) ?? 0;
      const deductionsForBar = deductionsByMonth.get(key) ?? 0;
      bars.push({
        date: `${key}-01`,
        total: round2(revenueForBar),
        profit: round2(revenueForBar - deductionsForBar),
        hasData: activeMonths.has(key),
      });
    }
  } else {
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      const key = d.toISOString().slice(0, 10);
      const revenueForBar = byDay.get(key) ?? 0;
      const deductionsForBar = deductionsByDay.get(key) ?? 0;
      bars.push({
        date: key,
        total: round2(revenueForBar),
        profit: round2(revenueForBar - deductionsForBar),
        hasData: activeDays.has(key),
      });
    }
  }

  return NextResponse.json({
    pointName,
    period: { granularity, start: start.toISOString(), end: end.toISOString() },
    total: round2(total),
    cash: round2(totalCash),
    mobile: round2(totalMobile),
    abonement: round2(totalAbonement),
    abonementSold: { cash: round2(abonementSoldCash), mobile: round2(abonementSoldMobile) },
    // Выручка Товаров за период (docs/spec/09-goods.md) — уже входит в total/
    // profitAndLoss выше, отдельное поле только для строки "в т.ч. Товары".
    goodsRevenue: round2(totalGoods),
    submissionsCount: submissionIds.size,
    deltaPercent,
    bars,
    profitAndLoss: {
      revenue: round2(total),
      expenses: round2(expenses),
      payouts: round2(payouts),
      profit: round2(total - expenses - payouts),
    },
  });
}
