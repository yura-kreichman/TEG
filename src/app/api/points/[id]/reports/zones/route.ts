import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { computeZoneSubmissionRevenues, resolvePeriodFromParams, round2, sumByKey } from "@/lib/reports";
import { getTenantModuleFlags } from "@/lib/tenant-modules";

// Тот же приём сентинелов, что уже у "По кассам" (operator/page.tsx,
// money/zone-balances/page.tsx) — Абонементы/Товары не зоны, но такая же
// касса, участвующая в ранжировании "Выручка по кассам" наравне с зонами
// (запрос пользователя 2026-07-25: "чтобы видеть продажи абонементов и
// товаров", раньше вкладка честно, но неудобно показывала только зоны).
const ABONEMENT_POOL_ID = "__abonement__";
const GOODS_POOL_ID = "__goods__";

export async function GET(request: Request, ctx: RouteContext<"/api/points/[id]/reports/zones">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

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
  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const { start, end, granularity } = resolvePeriodFromParams(searchParams, today, tenant?.timezone ?? "UTC");

  const zones = await prisma.zone.findMany({
    where: isAllPoints ? { point: { tenantId: owner.tenantId } } : { pointId },
    include: {
      assets: { orderBy: { sortOrder: "asc" } },
      tariffs: { where: { deletedAt: null } },
      // Имя точки — нужно только в режиме "Все точки", чтобы отличать
      // одноимённые зоны разных точек в списке (запрос пользователя
      // 2026-07-16) и группировать по точке (запрос пользователя
      // 2026-07-19), но проще всегда включать, чем городить условный тип include.
      point: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const zoneIds = zones.map((z) => z.id);
  const entries = await computeZoneSubmissionRevenues(zoneIds, start, end);

  const actualByZone = new Map<string, number>();
  for (const e of entries) {
    actualByZone.set(e.zoneId, (actualByZone.get(e.zoneId) ?? 0) + e.actualTotal);
  }
  // Абонементы/Товары — не зона, но такая же "касса" (запрос пользователя
  // 2026-07-25: "переименовать в Кассы, чтобы видеть продажи абонементов и
  // товаров") — деньги за пополнение баланса/продажу товара физически не
  // привязаны ни к одной зоне (пополнение — экран "Клиенты", не зона; товар
  // продаётся вне зон вовсе), поэтому раньше вкладка их просто не
  // показывала. Теперь — отдельные строки ранжирования наравне с зонами,
  // тот же принцип, что уже у "По кассам" в инкассации. Абонементы — по
  // ПОПОЛНЕНИЮ (см. reports/money/route.ts), не по трате. Товары —
  // goods_revenue/goods_revenue_cashless, БЕЗ goods_revenue_abonement (та
  // сумма уже учтена в момент пополнения баланса).
  const { goodsEnabled, clientsEnabled } = await getTenantModuleFlags(owner.tenantId);
  const pointFilter = isAllPoints ? { tenantId: owner.tenantId } : { pointId };
  const [abonementOps, goodsOps] = await Promise.all([
    clientsEnabled
      ? prisma.moneyOperation.findMany({
          where: { type: { in: ["abonement_topup", "abonement_topup_cashless"] }, occurredAt: { gte: start, lt: end }, ...pointFilter },
          select: { amount: true },
        })
      : Promise.resolve([]),
    goodsEnabled
      ? prisma.moneyOperation.findMany({
          where: { type: { in: ["goods_revenue", "goods_revenue_cashless"] }, occurredAt: { gte: start, lt: end }, ...pointFilter },
          select: { amount: true },
        })
      : Promise.resolve([]),
  ]);
  const abonementRevenue = abonementOps.reduce((sum, op) => sum + Number(op.amount), 0);
  const goodsRevenue = goodsOps.reduce((sum, op) => sum + Number(op.amount), 0);

  const pointTotal = [...actualByZone.values()].reduce((sum, v) => sum + v, 0) + abonementRevenue + goodsRevenue;

  const zoneRanking: {
    zoneId: string;
    zoneName: string;
    pointId: string | null;
    pointName: string | null;
    iconKey: string | null;
    total: number;
    sharePercent: number;
  }[] = zones.map((z) => {
    const total = actualByZone.get(z.id) ?? 0;
    return {
      zoneId: z.id,
      zoneName: z.name,
      pointId: isAllPoints ? z.pointId : null,
      pointName: isAllPoints ? z.point.name : null,
      iconKey: z.iconKey,
      total: round2(total),
      sharePercent: pointTotal > 0 ? Math.round((total / pointTotal) * 1000) / 10 : 0,
    };
  });
  if (isAllPoints) {
    // Группировка по точке вместо суффикса "Зона · Точка" у каждой строки
    // (запрос пользователя 2026-07-19: "занимает много места на экране") —
    // список остаётся плоским массивом, но уже отсортирован так, что зоны
    // одной точки идут подряд: клиент рисует заголовок группы при смене
    // pointId. Точки — по суммарной выручке точки, зоны внутри — по своей.
    const totalByPoint = new Map<string, number>();
    for (const z of zoneRanking) totalByPoint.set(z.pointId!, (totalByPoint.get(z.pointId!) ?? 0) + z.total);
    zoneRanking.sort((a, b) => {
      const byPoint = (totalByPoint.get(b.pointId!) ?? 0) - (totalByPoint.get(a.pointId!) ?? 0);
      if (byPoint !== 0) return byPoint;
      if (a.pointId !== b.pointId) return (a.pointName ?? "").localeCompare(b.pointName ?? "", "ru");
      return b.total - a.total;
    });
  } else {
    zoneRanking.sort((a, b) => b.total - a.total);
  }

  // Абонементы/Товары — фиксированным хвостом ПОСЛЕ зон, не встроены в
  // сортировку по сумме (запрос пользователя 2026-07-25: "сначала зоны по
  // списку, а потом Абонементы и товары, как и в инкассации") — тот же
  // порядок, что в "По кассам" (operator/page.tsx: зоны → Абонементы →
  // Товары). Без группировки по точке даже в "Все точки" (проще одной
  // сводной строкой на тенант, чем городить per-point разбивку ради двух
  // вспомогательных строк) и без записи в actualByZone/zoneIds — их
  // сознательно нет в drill-down "Активы"/"Тарифы" ниже, там нечего
  // показывать. zoneName пустой намеренно — клиент сам подставляет
  // переведённую подпись и иконку по сентинелу zoneId, сервер не
  // занимается i18n-строками.
  if (clientsEnabled && abonementRevenue > 0) {
    zoneRanking.push({
      zoneId: ABONEMENT_POOL_ID,
      zoneName: "",
      pointId: null,
      pointName: null,
      iconKey: null,
      total: round2(abonementRevenue),
      sharePercent: pointTotal > 0 ? Math.round((abonementRevenue / pointTotal) * 1000) / 10 : 0,
    });
  }
  if (goodsEnabled && goodsRevenue > 0) {
    zoneRanking.push({
      zoneId: GOODS_POOL_ID,
      zoneName: "",
      pointId: null,
      pointName: null,
      iconKey: null,
      total: round2(goodsRevenue),
      sharePercent: pointTotal > 0 ? Math.round((goodsRevenue / pointTotal) * 1000) / 10 : 0,
    });
  }

  const requestedZoneId = searchParams.get("zoneId");
  // Фоллбэк — первая РЕАЛЬНАЯ зона в списке, не просто zoneRanking[0]:
  // Абонементы/Товары — псевдо-строки без активов/тарифов, если одна из них
  // окажется топ-1 по выручке, drill-down "Активы"/"Тарифы" не должен
  // пропадать вовсе, просто должен указывать на первую настоящую зону.
  const drillZoneId =
    requestedZoneId && zoneIds.includes(requestedZoneId)
      ? requestedZoneId
      : zoneRanking.find((z) => zoneIds.includes(z.zoneId))?.zoneId;
  const drillZone = zones.find((z) => z.id === drillZoneId) ?? null;

  let assetRanking: {
    assetId: string;
    assetName: string;
    colorTag: string;
    photoUrl: string | null;
    iconKey: string | null;
    total: number;
    sharePercent: number;
  }[] = [];
  let tariffBreakdown: { tariffId: string; tariffName: string; total: number; sharePercent: number }[] = [];

  if (drillZone) {
    const zoneEntries = entries.filter((e) => e.zoneId === drillZone.id);
    const perAssetRaw = sumByKey(zoneEntries, "perAsset");
    const perTariffRaw = sumByKey(zoneEntries, "perTariff");
    const rawTotal = [...perAssetRaw.values()].reduce((sum, v) => sum + v, 0);
    // Чистая теоретическая сумма (сеансы × цена тарифа), без подгонки под
    // реально сданные деньги по зоне — раньше домножали на
    // (реально сдано / теоретическая сумма), из-за чего целые цены тарифов
    // превращались в копейки, а пользователь не мог узнать в отчёте свои же
    // целые тарифы (фидбек пользователя 2026-07-15). Сумма активов теперь
    // может не совпадать точь-в-точь с фактически сданной суммой по зоне,
    // если по факту была недостача/излишек — это ожидаемо, "Разница" по
    // зоне уже показана отдельно на вкладке Динамика/Деньги.
    assetRanking = drillZone.assets.map((a) => {
      const total = perAssetRaw.get(a.id) ?? 0;
      return {
        assetId: a.id,
        assetName: a.name,
        colorTag: a.colorTag,
        photoUrl: a.photoUrl,
        iconKey: a.iconKey,
        total: round2(total),
        sharePercent: rawTotal > 0 ? Math.round((total / rawTotal) * 1000) / 10 : 0,
      };
    });

    tariffBreakdown = drillZone.tariffs
      .map((t) => {
        const total = perTariffRaw.get(t.id) ?? 0;
        return {
          tariffId: t.id,
          tariffName: t.name,
          total: round2(total),
          sharePercent: rawTotal > 0 ? Math.round((total / rawTotal) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  return NextResponse.json({
    pointName,
    period: { granularity, start: start.toISOString(), end: end.toISOString() },
    zoneRanking,
    drillZoneId: drillZone?.id ?? null,
    drillZoneName: drillZone ? (isAllPoints ? `${drillZone.name} · ${drillZone.point.name}` : drillZone.name) : null,
    assetRanking,
    tariffBreakdown,
  });
}
