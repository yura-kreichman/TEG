import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getPeriodRange, isPeriodGranularity, parseDateParam, round2 } from "@/lib/reports";
import { zonedWallTimeToUtc } from "@/lib/business-day";
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
  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const timezone = tenant?.timezone ?? "UTC";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const granularityParam = searchParams.get("granularity");
  const fromParts = fromParam ? parseDateParam(fromParam) : null;
  const toParts = toParam ? parseDateParam(toParam) : null;
  let start: Date;
  let end: Date;
  if (fromParts && toParts) {
    start = zonedWallTimeToUtc(fromParts.year, fromParts.month, fromParts.day, 0, 0, timezone);
    const nextDay = new Date(Date.UTC(toParts.year, toParts.month - 1, toParts.day + 1));
    end = zonedWallTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 0, 0, timezone);
  } else {
    const granularity = isPeriodGranularity(granularityParam) ? granularityParam : "month";
    const anchorParam = searchParams.get("anchor");
    const anchorParts = anchorParam ? parseDateParam(anchorParam) : null;
    const anchor = anchorParts
      ? zonedWallTimeToUtc(anchorParts.year, anchorParts.month, anchorParts.day, 12, 0, timezone)
      : today;
    ({ start, end } = getPeriodRange(granularity, anchor, today, timezone));
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
  if (pointId) where.pointId = pointId;
  if (goodsId) where.goodsId = goodsId;
  if (categoryId) where.goods = { categoryId };
  if (operatorId) where.performedByOperatorId = operatorId;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (!includeVoided) where.voidedAt = null;

  const sales = await prisma.goodsSale.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 300,
    include: {
      goods: { select: { name: true, categoryId: true } },
      point: { select: { name: true, iconKey: true } },
      performedByOperator: { select: { name: true, avatarUrl: true, iconKey: true } },
      performedByUser: { select: { id: true } },
    },
  });

  const nonVoided = sales.filter((s) => !s.voidedAt);
  const summary = {
    count: nonVoided.reduce((sum, s) => sum + s.quantity, 0),
    revenue: nonVoided.reduce((sum, s) => sum + Number(s.amount), 0),
    cash: nonVoided.filter((s) => s.paymentMethod === "cash").reduce((sum, s) => sum + Number(s.amount), 0),
    mobile: nonVoided.filter((s) => s.paymentMethod === "mobile").reduce((sum, s) => sum + Number(s.amount), 0),
    abonement: nonVoided.filter((s) => s.paymentMethod === "abonement").reduce((sum, s) => sum + Number(s.amount), 0),
  };

  // График — тот же паттерн, что "Отчёты → Динамика" (запрос пользователя
  // 2026-07-19), но однослойный (только выручка Товаров, без "Прибыли" —
  // расходы не привязаны к конкретному товару). За "Год" агрегируем по
  // месяцам (12 столбцов), иначе — по дням; тот же приём, что
  // /api/points/[id]/reports/dynamics.
  const byDay = new Map<string, number>();
  const activeDays = new Set<string>();
  for (const s of nonVoided) {
    const key = s.occurredAt.toISOString().slice(0, 10);
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
    for (let m = new Date(start); m < end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
      bars.push({ date: `${key}-01`, total: round2(byMonth.get(key) ?? 0), hasData: activeMonths.has(key) });
    }
  } else {
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      const key = d.toISOString().slice(0, 10);
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
      performedBy: s.performedByOperator?.name ?? null,
      performedByOwner: !!s.performedByUser,
      performedByAvatarUrl: s.performedByOperator?.avatarUrl ?? null,
      performedByIconKey: s.performedByOperator?.iconKey ?? null,
      occurredAt: s.occurredAt,
      voidedAt: s.voidedAt,
    })),
  });
}
