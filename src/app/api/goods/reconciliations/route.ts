import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, findTenantPoint } from "@/lib/require-owner";
import { calculateGoodsCashSince, reconcileGoodsCash } from "@/lib/goods";
import { getPeriodRange, isPeriodGranularity, round2 } from "@/lib/reports";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Сверка кассы Товаров (docs/spec/09-goods.md, "Сверка кассы") — НЕ
// привязана к ResultsSubmission. GET отдаёт историю + расчётную кассу с
// последней сверки этой точки (для формы новой сверки). История и график —
// теперь тоже за период (День/Неделя/Месяц/Год/Период, запрос пользователя
// 2026-07-19: "иначе список потом будет бесконечный") — тот же приём, что
// /api/goods/sales; pending (расчётная касса с последней сверки "по сейчас")
// НЕ ограничена периодом — это текущее состояние, не историческая метрика.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");

  const today = new Date();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const granularityParam = searchParams.get("granularity");
  let start: Date;
  let end: Date;
  if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    start = new Date(`${fromParam}T00:00:00.000Z`);
    end = new Date(new Date(`${toParam}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  } else {
    const granularity = isPeriodGranularity(granularityParam) ? granularityParam : "month";
    const anchorParam = searchParams.get("anchor");
    const anchor = anchorParam && /^\d{4}-\d{2}-\d{2}$/.test(anchorParam) ? new Date(`${anchorParam}T00:00:00.000Z`) : today;
    ({ start, end } = getPeriodRange(granularity, anchor, today));
  }

  const [reconciliations, pending] = await Promise.all([
    prisma.goodsReconciliation.findMany({
      where: { tenantId: owner.tenantId, ...(pointId ? { pointId } : {}), occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: "desc" },
      take: 100,
      include: {
        point: { select: { name: true } },
        performedByOperator: { select: { name: true, avatarUrl: true, iconKey: true } },
        performedByUser: { select: { id: true } },
      },
    }),
    pointId ? calculateGoodsCashSince(owner.tenantId, pointId) : null,
  ]);

  // График — тот же паттерн, что "Отчёты → Динамика"/"Продажи" (запрос
  // пользователя 2026-07-19), сумма сданных Наличные+Безнал по дню сдачи.
  const byDay = new Map<string, number>();
  const activeDays = new Set<string>();
  for (const r of reconciliations) {
    const key = r.occurredAt.toISOString().slice(0, 10);
    const amount = Number(r.actualCash) + Number(r.actualMobile);
    byDay.set(key, (byDay.get(key) ?? 0) + amount);
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

  return NextResponse.json({
    period: { start: start.toISOString(), end: end.toISOString() },
    pending,
    bars,
    reconciliations: reconciliations.map((r) => ({
      id: r.id,
      pointName: r.point.name,
      performedBy: r.performedByOperator?.name ?? null,
      performedByOwner: !!r.performedByUser,
      performedByAvatarUrl: r.performedByOperator?.avatarUrl ?? null,
      performedByIconKey: r.performedByOperator?.iconKey ?? null,
      actualCash: Number(r.actualCash),
      actualMobile: Number(r.actualMobile),
      occurredAt: r.occurredAt,
    })),
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const pointId: string = typeof body.pointId === "string" ? body.pointId : "";
  const actualCash = Number(body.actualCash);
  const actualMobile = Number(body.actualMobile);

  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }
  if (!Number.isFinite(actualCash) || actualCash < 0 || !Number.isFinite(actualMobile) || actualMobile < 0) {
    return NextResponse.json({ error: "Укажите фактические суммы" }, { status: 400 });
  }

  const reconciliation = await reconcileGoodsCash({
    tenantId: owner.tenantId,
    pointId,
    actualCash,
    actualMobile,
    actor: { userId: owner.user.id },
  });
  return NextResponse.json({ id: reconciliation.id }, { status: 201 });
}
