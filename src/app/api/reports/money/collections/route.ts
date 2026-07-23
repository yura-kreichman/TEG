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
// Четыре "формы" инкассации в одном списке: type=collection (касса зоны),
// два отдельных типа для абонементов/товаров наличными точки —
// collection_pool_sweep_abonement / _goods (не привязаны ни к одной зоне,
// свои собственные кассы — см. lib/zone-balance.ts и дропдаун "По кассам") —
// и collection_advance ("Аванс инкассации", lib/zone-balance.ts, "Аванс
// инкассации") — деньги без зоны-адреса, ждущие будущей сдачи итогов.
// Раньше был один общий тип без видимой суммы, из-за чего такая инкассация
// вообще не попадала в реестр (реальный баг, найден пользователем
// 2026-07-22: "абонементы исчезли а в реестре ничего не добавилось");
// разделены на два (тот же день, "могут быть и 2 пачки — Сотрудник продавал
// абонементы, а продавец Поп-корн"). collection_advance добавлен в реестр
// позже (реальный баг, найден пользователем 2026-07-25: тип вообще не был
// заведён сюда — инкассация проходила и деньги учитывались верно, но
// строка в "Реестре инкассаций" молча не появлялась).
//
// Пятый тип — advance/bonus_payout, но только САМООБСЛУЖИВАНИЕ сотрудника
// (performedByOperatorId, физически из кассы точки — см. getPointCashBalance
// в lib/zone-balance.ts; владельческие "не из кассы точки" — не показываем,
// не создают "пул"). Запрос пользователя 2026-07-25: без этого владелец
// видит эффект (задним числом, при следующей инкассации, зоны "внезапно"
// списываются) без причины — теперь сам факт "сотрудник забрал аванс/премию"
// виден в реестре сразу, в момент, когда это произошло, а не только когда
// система потом доразносит его по зонам.
//
// Зонные записи ПОГАШЕНИЯ этого же аванса/премии (или "Аванса инкассации")
// сюда НАРОЧНО не попадают — с 2026-07-25 они пишутся отдельным типом
// "advance_settlement" (не "collection", см. chargeSelfServiceAdvanceToZones/
// settleOutstandingCollectionAdvance в lib/zone-balance.ts), и запрос выше
// (type: "collection") их просто не видит. Запрос пользователя того же дня:
// "зачем так много строк, пусть будет написано, что просто [сотрудник] взял
// аванс" — сам факт уже виден одной строкой выше, построчная разбивка по
// зонам, куда именно ушло погашение, только шумит.
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

  const [zoneOps, poolOps, advanceOps, takenOps] = await Promise.all([
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
    prisma.moneyOperation.findMany({
      where: {
        tenantId: owner.tenantId,
        type: "collection_advance",
        // Только отрицательные — это НОВЫЙ аванс, который владелец реально
        // внёс (см. /api/points/[id]/collection/general). Положительные
        // collection_advance — не отдельное событие инкассации, а служебная
        // проводка settleOutstandingCollectionAdvance (lib/zone-balance.ts),
        // гасящая старый аванс уже показанными ниже zone-level "collection"
        // операциями — показывать её тут второй раз как ещё один аванс
        // было бы обманчиво.
        amount: { lt: 0 },
        occurredAt: { gte: monthStart, lt: monthEnd },
        ...(pointId ? { pointId } : {}),
      },
      include: { point: true },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.moneyOperation.findMany({
      where: {
        tenantId: owner.tenantId,
        type: { in: ["advance", "bonus_payout"] },
        // Только самообслуживание — physически из кассы точки (тот же
        // фильтр, что getPointCashBalance использует для "пула").
        performedByOperatorId: { not: null },
        occurredAt: { gte: monthStart, lt: monthEnd },
        ...(pointId ? { pointId } : {}),
      },
      include: { point: true, beneficiaryOperator: true, performedByOperator: true },
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
        comment: op.comment,
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
        comment: op.comment,
      })),
    ...advanceOps
      .filter((op) => op.point !== null)
      .map((op) => ({
        id: op.id,
        occurredAt: op.occurredAt.toISOString(),
        zoneName: null as string | null,
        pointName: op.point!.name,
        amount: Math.abs(Number(op.amount)),
        pool: "advance" as const,
        operatorName: null as string | null,
        comment: op.comment,
      })),
    ...takenOps
      .filter((op) => op.point !== null)
      .map((op) => ({
        id: op.id,
        occurredAt: op.occurredAt.toISOString(),
        zoneName: null as string | null,
        pointName: op.point!.name,
        amount: Math.abs(Number(op.amount)),
        pool: (op.type === "advance" ? "advance_taken" : "bonus_taken") as "advance_taken" | "bonus_taken",
        operatorName: op.beneficiaryOperator?.name ?? op.performedByOperator?.name ?? null,
        comment: op.comment,
      })),
  ].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  // Название точки в строке имеет смысл, только если точек больше одной
  // (запрос пользователя 2026-07-14 — и так ясно, если она одна).
  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });

  return NextResponse.json({ collections, showPointName: pointCount > 1 });
}
