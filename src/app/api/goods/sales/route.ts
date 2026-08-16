import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantDayContext } from "@/lib/tenant-day";
import { requireOwner } from "@/lib/require-owner";
import { getPeriodRange, isPeriodGranularity, parseDateParam, round2 } from "@/lib/reports";
import { businessDayOf, dayBoundsUtc, localDateParts, parseBoundary, zonedWallTimeToUtc } from "@/lib/business-day";
import { isModuleEnabled } from "@/lib/tenant-modules";
import type { Prisma } from "@/generated/prisma/client";

// Вкладка "Покупки" (docs/spec/09-goods.md, "Кабинет владельца") — шапка-
// сводка за период + список с фильтрами точка/категория/товар/оператор/
// способ оплаты. День/Неделя/Месяц/Год/Период — тот же выбор периода, что
// /api/reports/money (запрос пользователя 2026-07-19: "добавить
// День/Неделя/Месяц/Год/Период как в Деньгах"): granularity+anchor ИЛИ явный
// диапазон from/to (режим "Период"), с тем же приоритетом (from/to,
// если оба валидны, побеждают granularity).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const today = new Date();
  // Часовой пояс тенанта (аудит 2026-07-25, повторная проверка) — границы
  // периода должны совпадать с местным календарным днём владельца, не с
  // сырым UTC сервера, см. комментарий у getPeriodRange в lib/reports.ts.
  const { timezone, boundary } = await getTenantDayContext(owner.tenantId);
  const { hours: bh, minutes: bm } = parseBoundary(boundary);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const granularityParam = searchParams.get("granularity");
  const fromParts = fromParam ? parseDateParam(fromParam) : null;
  const toParts = toParam ? parseDateParam(toParam) : null;
  let start: Date;
  let end: Date;
  if (fromParts && toParts) {
    start = zonedWallTimeToUtc(fromParts.year, fromParts.month, fromParts.day, bh, bm, timezone);
    const nextDay = new Date(Date.UTC(toParts.year, toParts.month - 1, toParts.day + 1));
    end = zonedWallTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), bh, bm, timezone);
  } else {
    const granularity = isPeriodGranularity(granularityParam) ? granularityParam : "month";
    const anchorParam = searchParams.get("anchor");
    const anchorParts = anchorParam ? parseDateParam(anchorParam) : null;
    const anchor = anchorParts
      ? zonedWallTimeToUtc(anchorParts.year, anchorParts.month, anchorParts.day, 12, 0, timezone)
      : today;
    ({ start, end } = getPeriodRange(granularity, anchor, today, timezone, boundary));
  }

  const where: Prisma.GoodsSaleWhereInput = {
    tenantId: owner.tenantId,
    occurredAt: { gte: start, lt: end },
  };
  const pointId = searchParams.get("pointId");
  const categoryId = searchParams.get("categoryId");
  const goodsId = searchParams.get("goodsId");
  const operatorId = searchParams.get("operatorId");
  const paymentMethod = searchParams.get("paymentMethod");
  const includeVoided = searchParams.get("includeVoided") === "1";
  // Поиск по клиенту (запрос владельца 2026-08-16) — продажа может быть
  // привязана к кошельку (оплата балансом или просто отмеченный клиент);
  // без привязки это гость, и в поиск такие строки не попадают.
  const q = (searchParams.get("q") ?? "").trim();
  if (pointId) where.pointId = pointId;
  if (goodsId) where.goodsId = goodsId;
  if (categoryId) where.goods = { categoryId };
  if (operatorId) where.performedByOperatorId = operatorId;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (!includeVoided) where.voidedAt = null;
  if (q) {
    where.wallet = { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] };
  }

  const sales = await prisma.goodsSale.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 300,
    include: {
      goods: { select: { name: true, categoryId: true } },
      point: { select: { name: true, iconKey: true } },
      performedByOperator: { select: { name: true, avatarUrl: true, iconKey: true, colorTag: true } },
      performedByUser: { select: { id: true } },
      wallet: { select: { id: true, name: true, phone: true } },
    },
  });

  const nonVoided = sales.filter((s) => !s.voidedAt);
  let cash = nonVoided.filter((s) => s.paymentMethod === "cash").reduce((sum, s) => sum + Number(s.amount), 0);
  let mobile = nonVoided.filter((s) => s.paymentMethod === "mobile").reduce((sum, s) => sum + Number(s.amount), 0);
  let abonement = nonVoided.filter((s) => s.paymentMethod === "abonement").reduce((sum, s) => sum + Number(s.amount), 0);
  // Разбивка оплаты (аудит 2026-07-26) — без этого сплит-продажи не попадали
  // ни в одну из 3 корзин выше, и cash+mobile+abonement переставали сходиться
  // с revenue ровно на сумму сплит-продаж.
  // Доли нужны и для сумм, и для иконок методов в строке (запрос владельца
  // 2026-08-16: "их может быть и 3 — нал/безнал/баланс"), поэтому держим их
  // разложенными по продаже. Берём по ВСЕМ продажам списка, включая
  // аннулированные: иконки у них тоже рисуются, а в суммы попадают только
  // неаннулированные — фильтр ниже.
  const splitSaleIds = sales.filter((s) => s.paymentMethod === "split").map((s) => s.id);
  const legsBySale = new Map<string, { method: string; amount: number }[]>();
  if (splitSaleIds.length > 0) {
    const legs = await prisma.goodsSalePaymentLeg.findMany({ where: { saleId: { in: splitSaleIds } } });
    const voidedIds = new Set(sales.filter((s) => s.voidedAt).map((s) => s.id));
    for (const leg of legs) {
      const list = legsBySale.get(leg.saleId) ?? [];
      list.push({ method: leg.method, amount: Number(leg.amount) });
      legsBySale.set(leg.saleId, list);
      if (voidedIds.has(leg.saleId)) continue;
      const amount = Number(leg.amount);
      if (leg.method === "cash") cash += amount;
      else if (leg.method === "mobile") mobile += amount;
      else if (leg.method === "abonement") abonement += amount;
    }
  }
  const summary = {
    count: nonVoided.reduce((sum, s) => sum + s.quantity, 0),
    revenue: nonVoided.reduce((sum, s) => sum + Number(s.amount), 0),
    cash,
    mobile,
    abonement,
  };

  // График — тот же паттерн, что "Отчёты → Динамика" (запрос пользователя
  // 2026-07-19), но однослойный (только выручка Товаров, без "Прибыли" —
  // расходы не привязаны к конкретному товару). За "Год" агрегируем по
  // месяцам (12 столбцов), иначе — по дням; тот же приём, что
  // /api/points/[id]/reports/dynamics.
  // Ключ дня — местная календарная дата тенанта, не сырой UTC (аудит
  // 2026-07-24, тот же класс бага, что и у /reports/points/[id]/reports/*
  // и /api/goods/reconciliations).
  const dateKey = (d: Date) => {
    const { year: y, month: m, day } = businessDayOf(d, timezone, boundary);
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const byDay = new Map<string, number>();
  const activeDays = new Set<string>();
  for (const s of nonVoided) {
    const key = dateKey(s.occurredAt);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(s.amount));
    activeDays.add(key);
  }
  const bars: { date: string; total: number; hasData: boolean }[] = [];
  if (granularityParam === "year") {
    const byMonth = new Map<string, number>();
    const activeMonths = new Set<string>();
    for (const [dayKey, value] of byDay) {
      const monthKey = dayKey.slice(0, 7);
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + value);
    }
    for (const dayKey of activeDays) activeMonths.add(dayKey.slice(0, 7));
    let { year: mYear, month: mMonth } = localDateParts(start, timezone);
    while (dayBoundsUtc(mYear, mMonth, 1, timezone, boundary).start < end) {
      const key = `${mYear}-${String(mMonth).padStart(2, "0")}`;
      bars.push({ date: `${key}-01`, total: round2(byMonth.get(key) ?? 0), hasData: activeMonths.has(key) });
      if (mMonth === 12) {
        mYear += 1;
        mMonth = 1;
      } else {
        mMonth += 1;
      }
    }
  } else {
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      const key = dateKey(d);
      bars.push({ date: key, total: round2(byDay.get(key) ?? 0), hasData: activeDays.has(key) });
    }
  }

  // Дельта к предыдущему периоду той же длины (день/неделя/месяц/год или
  // произвольный диапазон — универсально, без привязки к календарным
  // границам месяца/года, в отличие от getPreviousPeriodRange).
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  const prevRevenueOps = await prisma.goodsSale.findMany({
    where: { ...where, occurredAt: { gte: prevStart, lt: prevEnd } },
    select: { amount: true },
  });
  const prevTotal = prevRevenueOps.reduce((sum, s) => sum + Number(s.amount), 0);
  const deltaPercent = prevTotal > 0 ? Math.round(((summary.revenue - prevTotal) / prevTotal) * 1000) / 10 : null;

  return NextResponse.json({
    period: { start: start.toISOString(), end: end.toISOString() },
    summary,
    bars,
    deltaPercent,
    sales: sales.map((s) => ({
      id: s.id,
      goodsName: s.goods.name,
      categoryId: s.goods.categoryId,
      pointName: s.point.name,
      pointIconKey: s.point.iconKey,
      quantity: s.quantity,
      amount: Number(s.amount),
      paymentMethod: s.paymentMethod,
      // Методы для иконок в строке: у разбивки их до трёх — наличные,
      // безнал и баланс (запрос владельца 2026-08-16).
      methods:
        s.paymentMethod === "split"
          ? [...new Set((legsBySale.get(s.id) ?? []).map((leg) => leg.method))]
          : [s.paymentMethod],
      performedBy: s.performedByOperator?.name ?? null,
      performedByOwner: !!s.performedByUser,
      performedByAvatarUrl: s.performedByOperator?.avatarUrl ?? null,
      performedByIconKey: s.performedByOperator?.iconKey ?? null,
      performedByColorTag: s.performedByOperator?.colorTag ?? null,
      // Клиент продажи; null — гость (покупка без привязки к кошельку).
      clientName: s.wallet?.name ?? null,
      clientPhone: s.wallet?.phone ?? null,
      occurredAt: s.occurredAt,
      voidedAt: s.voidedAt,
    })),
  });
}
