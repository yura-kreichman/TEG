import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantDayContext } from "@/lib/tenant-day";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import {
  computeZoneSubmissionRevenues,
  getPreviousCustomRange,
  getPreviousPeriodRange,
  resolvePeriodFromParams,
  round2,
} from "@/lib/reports";
import { businessDayOf, dayBoundsUtc, localDateParts } from "@/lib/business-day";

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
  // Часовой пояс тенанта (аудит 2026-07-25, повторная проверка) — см.
  // комментарий у getPeriodRange в lib/reports.ts.
  const { timezone, boundary } = await getTenantDayContext(owner.tenantId);
  const { start, end, granularity, isCustom } = resolvePeriodFromParams(searchParams, today, timezone, boundary);
  const { start: prevStart, end: prevEnd } = isCustom
    ? getPreviousCustomRange(start, end)
    : getPreviousPeriodRange(granularity, start, timezone, boundary);
  // Ключ дня — местная календарная дата тенанта, не сырой UTC (аудит
  // 2026-07-24: тот же класс бага, что и у /reports/counters/day/calendar —
  // toISOString() читает UTC-дату момента, а не местную).
  const dateKey = (d: Date) => {
    const { year: y, month: m, day } = businessDayOf(d, timezone, boundary);
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

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
    const dayKey = dateKey(s.resultsSubmission.submittedAt);
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
  // Товары (docs/spec/09-goods.md, "Отчётность и размещение": "товары —
  // равноправный слой стека рядом с зонами") — гросс-выручка наличными и
  // безналом, прибавляется к total/byDay, визуально график линейный (не
  // столбчатый), отдельного слоя не рисует. goods_revenue_abonement (товар,
  // оплаченный балансом) сюда НЕ входит — эти деньги уже посчитаны в
  // totalCash/totalMobile ниже в момент пополнения баланса, не когда
  // потрачены на товар.
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
      const key = dateKey(op.occurredAt);
      deductionsByDay.set(key, (deductionsByDay.get(key) ?? 0) + amount);
      activeDays.add(key);
    }
    // Абонементы (пересмотрено 2026-07-25 дважды — сперва отдельной строкой
    // "Баланс", это оказалось ошибкой: та же иконка/подпись, что везде
    // означает "клиент заплатил СО своего баланса" — а тут наоборот деньги
    // ЗА пополнение, реальные наличные/безнал клиента. Слито в totalCash/
    // totalMobile по факту способа оплаты пополнения, тем же принципом, что
    // и Товары ниже — не отдельная вводящая в заблуждение строка.
    // revenue_abonement/goods_revenue_abonement (трата) по-прежнему не
    // входят вовсе — деньги уже учтены в момент пополнения.
    if (op.type === "abonement_topup" || op.type === "abonement_topup_cashless") {
      if (op.type === "abonement_topup") totalCash += amount;
      else totalMobile += amount;
      const key = dateKey(op.occurredAt);
      byDay.set(key, (byDay.get(key) ?? 0) + amount);
      activeDays.add(key);
    }
    if (op.type === "goods_revenue" || op.type === "goods_revenue_cashless") {
      // Знаковая сумма, НЕ Math.abs(amount) выше — аннулирование продажи
      // (voidGoodsSale, src/lib/goods.ts) пишет компенсирующую операцию с
      // ОТРИЦАТЕЛЬНОЙ суммой того же типа, она должна вычесть из выручки,
      // а не снова прибавиться по модулю.
      const signedAmount = Number(op.amount);
      totalGoods += signedAmount;
      const key = dateKey(op.occurredAt);
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
        type: { in: ["abonement_topup", "abonement_topup_cashless"] },
        occurredAt: { gte: prevStart, lt: prevEnd },
        ...(isAllPoints ? {} : { OR: [{ zone: { pointId } }, { pointId }] }),
      },
      select: { amount: true },
    }),
    prisma.moneyOperation.findMany({
      where: {
        tenantId: owner.tenantId,
        type: { in: ["goods_revenue", "goods_revenue_cashless"] },
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

  const total = totalCash + totalMobile + totalGoods;
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
    // Год/месяц из start читается местной календарной датой тенанта, не
    // getUTCFullYear()/getUTCMonth() (аудит 2026-07-24: start — момент
    // тенант-таймзонной полуночи 1 января, для тенанта восточнее UTC это
    // ещё 31 декабря по UTC — старый цикл начинал бы с декабря прошлого года).
    let { year: mYear, month: mMonth } = localDateParts(start, timezone);
    while (dayBoundsUtc(mYear, mMonth, 1, timezone, boundary).start < end) {
      const key = `${mYear}-${String(mMonth).padStart(2, "0")}`;
      const revenueForBar = byMonth.get(key) ?? 0;
      const deductionsForBar = deductionsByMonth.get(key) ?? 0;
      bars.push({
        date: `${key}-01`,
        total: round2(revenueForBar),
        profit: round2(revenueForBar - deductionsForBar),
        hasData: activeMonths.has(key),
      });
      if (mMonth === 12) {
        mYear += 1;
        mMonth = 1;
      } else {
        mMonth += 1;
      }
    }
  } else {
    // Локальный календарный день через dayBoundsUtc, не "+24ч в мс" (аудит
    // 2026-07-31) — тот же класс DST-бага, что getPreviousPeriodRange в
    // lib/reports.ts уже чинит через addCalendarDays: в сутки перехода на
    // летнее/зимнее время местные сутки длятся 23 или 25 часов, и наивное
    // прибавление 24ч давало dateKey(d) дважды одну и ту же локальную дату
    // (дубликат бара) либо пропускало последний день диапазона. Тот же
    // приём, что уже используется в ветке "year" чуть выше.
    let { year: dYear, month: dMonth, day: dDay } = localDateParts(start, timezone);
    while (dayBoundsUtc(dYear, dMonth, dDay, timezone, boundary).start < end) {
      const key = `${dYear}-${String(dMonth).padStart(2, "0")}-${String(dDay).padStart(2, "0")}`;
      const revenueForBar = byDay.get(key) ?? 0;
      const deductionsForBar = deductionsByDay.get(key) ?? 0;
      bars.push({
        date: key,
        total: round2(revenueForBar),
        profit: round2(revenueForBar - deductionsForBar),
        hasData: activeDays.has(key),
      });
      const next = new Date(Date.UTC(dYear, dMonth - 1, dDay + 1));
      dYear = next.getUTCFullYear();
      dMonth = next.getUTCMonth() + 1;
      dDay = next.getUTCDate();
    }
  }

  return NextResponse.json({
    pointName,
    period: { granularity, start: start.toISOString(), end: end.toISOString() },
    total: round2(total),
    cash: round2(totalCash),
    mobile: round2(totalMobile),
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
