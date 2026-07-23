import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { computeZoneSubmissionRevenues, resolvePeriodFromParams, round2, sumByKey } from "@/lib/reports";

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
  // Абонементная выручка (аудит 2026-07-24, реальное расхождение) — эта
  // касса зоны реального наличного/безналичного дня не получает (клиент уже
  // заплатил раньше, при пополнении), но это реальная выручка бизнеса и на
  // вкладке "Динамика" (соседний отчёт того же периода/точки) она есть в
  // total — здесь её не было вовсе, из-за чего суммы по зонам расходились с
  // "Динамикой" ровно на этот слой. Прямой запрос по MoneyOperation, не
  // entries[].abonementAmount — то поле считается только для
  // stays/launches/tickets (lib/reports.ts), у counters/cash_only своя,
  // отдельная запись без привязки к ZoneSubmission (spendWalletForZone).
  const abonementOps = zoneIds.length
    ? await prisma.moneyOperation.findMany({
        where: { zoneId: { in: zoneIds }, type: "revenue_abonement", occurredAt: { gte: start, lt: end } },
        select: { zoneId: true, amount: true },
      })
    : [];
  for (const op of abonementOps) {
    if (!op.zoneId) continue;
    actualByZone.set(op.zoneId, (actualByZone.get(op.zoneId) ?? 0) + Number(op.amount));
  }
  const pointTotal = [...actualByZone.values()].reduce((sum, v) => sum + v, 0);

  const zoneRanking = zones.map((z) => {
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

  const requestedZoneId = searchParams.get("zoneId");
  const drillZoneId = requestedZoneId && zoneIds.includes(requestedZoneId) ? requestedZoneId : zoneRanking[0]?.zoneId;
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
