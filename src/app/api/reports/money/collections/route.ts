import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Реестр инкассаций за месяц для компактного списка на странице «Остатки и
// инкассации» — замена календарю "Выручка по дням". pointId (запрос
// пользователя 2026-07-22: "не удобно смотреть все точки вместе") — сама
// страница теперь всегда сфокусирована на одной точке (дропдаун, если их
// больше одной), реестр скопирован под тот же принцип; без параметра — как
// раньше, весь тенант (обратная совместимость на случай других вызывающих).
//
// Три "формы" инкассации в одном списке: type=collection (касса зоны) и два
// отдельных типа для абонементов/товаров наличными точки — collection_pool_
// sweep_abonement / _goods (не привязаны ни к одной зоне, свои собственные
// кассы — см. lib/zone-balance.ts и дропдаун "По кассам"). Раньше был один
// общий тип без видимой суммы, из-за чего такая инкассация вообще не
// попадала в реестр (реальный баг, найден пользователем 2026-07-22:
// "абонементы исчезли а в реестре ничего не добавилось"); разделены на два
// (тот же день, "могут быть и 2 пачки — Сотрудник продавал абонементы, а
// продавец Поп-корн").
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month")); // 1-12
  const pointId = searchParams.get("pointId");

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const [zoneOps, poolOps] = await Promise.all([
    prisma.moneyOperation.findMany({
      where: {
        tenantId: owner.tenantId,
        type: "collection",
        occurredAt: { gte: monthStart, lt: monthEnd },
        ...(pointId ? { zone: { pointId } } : {}),
      },
      include: { zone: { include: { point: true } } },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.moneyOperation.findMany({
      where: {
        tenantId: owner.tenantId,
        type: { in: ["collection_pool_sweep_abonement", "collection_pool_sweep_goods"] },
        occurredAt: { gte: monthStart, lt: monthEnd },
        ...(pointId ? { pointId } : {}),
      },
      include: { point: true },
      orderBy: { occurredAt: "desc" },
    }),
  ]);

  const collections = [
    // "collection" всегда зонная операция (только advance/bonus_payout из
    // 05-work-time.md — точечные) — фильтр защищает только от гипотетических
    // будущих багов, не от реального пути в приложении.
    ...zoneOps
      .filter((op) => op.zone !== null)
      .map((op) => ({
        id: op.id,
        occurredAt: op.occurredAt.toISOString(),
        zoneName: op.zone!.name,
        pointName: op.zone!.point.name,
        amount: Math.abs(Number(op.amount)),
        pool: null as "abonement" | "goods" | null,
      })),
    ...poolOps
      .filter((op) => op.point !== null)
      .map((op) => ({
        id: op.id,
        occurredAt: op.occurredAt.toISOString(),
        // Строка без конкретной зоны — клиент подставляет переведённую
        // подпись по значению pool (t.money.abonementCashLabel / t.goods.navLabel).
        zoneName: null as string | null,
        pointName: op.point!.name,
        amount: Math.abs(Number(op.amount)),
        pool: (op.type === "collection_pool_sweep_abonement" ? "abonement" : "goods") as "abonement" | "goods",
      })),
  ].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  // Название точки в строке имеет смысл, только если точек больше одной
  // (запрос пользователя 2026-07-14 — и так ясно, если она одна).
  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });

  return NextResponse.json({ collections, showPointName: pointCount > 1 });
}
