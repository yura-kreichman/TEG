import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import {
  getPointAbonementCashTotal,
  getPointGoodsCashTotal,
  getPointPoolDeficit,
  getZoneBalances,
  settleOutstandingCollectionAdvance,
  splitCollectionAmountDetailed,
} from "@/lib/zone-balance";
import { distributeCollectionWhole } from "@/lib/collection-split";
import { dispatchCollection } from "@/lib/summary-channels/dispatch";

// Общая инкассация точки, но вносит владелец (запрос пользователя
// 2026-07-15: "как и у Сотрудника") — тот же принцип, что у оператора
// (/api/operator/collection/general): один общий итог, сервер сам делит его
// между зонами точки пропорционально их текущему остатку и пишет обычные
// zone-level операции collection. К введённой сумме автоматически
// прибавляется "пул" — аванс/премия, которые сотрудник уже забрал с точки
// после прошлой инкассации (lib/zone-balance.ts, getPointPoolDeficit) —
// иначе эти деньги зависают в журнале зон навсегда (решение пользователя
// 2026-07-16).
export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/collection/general">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Math.round(Number(amount));
  // < 0, не <= 0 — 0 допустим: способ вручную запустить погашение
  // накопленного аванса/пула, когда физически новых денег нет (запрос
  // пользователя 2026-07-22).
  if (!Number.isFinite(amountNumber) || amountNumber < 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zones = await prisma.zone.findMany({ where: { pointId } });
  if (zones.length === 0) {
    return NextResponse.json({ error: "На точке нет зон" }, { status: 400 });
  }

  const actor = { performedByUserId: owner.user.id };

  // Сначала гасим накопленный аванс инкассации остатками зон точки, если они
  // уже появились — до расчёта самой этой инкассации (lib/zone-balance.ts,
  // "Аванс инкассации").
  await settleOutstandingCollectionAdvance(owner.tenantId, pointId, actor);

  const balanceByZone = await getZoneBalances(zones.map((z) => z.id));
  const weights = zones.map((z) => balanceByZone.get(z.id) ?? 0);
  const zonesRawSum = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  const poolDeficit = await getPointPoolDeficit(pointId);
  // Сколько из "сырого" остатка зон РЕАЛЬНО свободно для новой инкассации —
  // не весь zonesRawSum, а за вычетом poolDeficit (реальный баг, найден
  // пользователем 2026-07-25: тот же остаток зон одновременно шёл и сюда, и
  // отдельно довзыскивался как poolDeficit ниже — одни и те же деньги
  // списывались с зон дважды. Пример: Женя забрал авансом ровно весь остаток
  // зон (255₽, poolDeficit=255) — к моменту новой инкассации в зонах
  // "физически свободно" 0, а не 255, все 255 уже обещаны погашению долга).
  const zonesAvailable = Math.max(0, zonesRawSum - poolDeficit);
  // Абонементы и товары наличными — НЕ привязаны ни к одной зоне никогда, и
  // друг с другом не смешиваются: это могут быть физически разные пачки денег
  // (запрос пользователя 2026-07-22: "могут быть и 2 пачки — Сотрудник
  // продавал абонементы, а продавец Поп-корн"). Разный учёт, одна инкассация
  // (решение пользователя того же дня) — свои независимые части разбивки, см.
  // splitCollectionAmountDetailed.
  const [abonementCash, goodsCash] = await Promise.all([
    getPointAbonementCashTotal(pointId),
    getPointGoodsCashTotal(pointId),
  ]);
  const { zonePortion, abonementSweepPortion, goodsSweepPortion, advance } = splitCollectionAmountDetailed(
    amountNumber,
    zonesAvailable,
    abonementCash,
    goodsCash
  );
  const shares = distributeCollectionWhole(zonePortion + poolDeficit, weights);

  const rows = zones
    .map((zone, i) => ({
      tenantId: owner.tenantId,
      zoneId: zone.id,
      type: "collection",
      amount: -Math.abs(shares[i]),
      performedByUserId: owner.user.id,
    }))
    .filter((row) => row.amount !== 0);

  if (rows.length > 0) {
    await prisma.moneyOperation.createMany({ data: rows });
  }
  // Абонементы/товары наличными физически забраны — реальной суммой, СВОИМ
  // типом каждый (не "collection_advance": та копится как ЖДУЩИЙ будущей
  // выручки остаток, а тут уже всё собрано и закрыто) — попадают в Реестр
  // инкассаций раздельными строками (реальный баг, найден пользователем
  // 2026-07-22: "абонементы исчезли а в реестре ничего не добавилось" —
  // раньше здесь писался один нулевой маркер без видимой суммы). Заодно
  // двигают СВОИ, независимые отсечки (lib/zone-balance.ts, getPoolSweepCutoff).
  if (abonementSweepPortion > 0) {
    await prisma.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId,
        type: "collection_pool_sweep_abonement",
        amount: -abonementSweepPortion,
        performedByUserId: owner.user.id,
      },
    });
  }
  if (goodsSweepPortion > 0) {
    await prisma.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId,
        type: "collection_pool_sweep_goods",
        amount: -goodsSweepPortion,
        performedByUserId: owner.user.id,
      },
    });
  }
  // "Аванс инкассации" — то, для чего пока нет ни зоны, ни пула, ждёт будущей
  // выручки (см. "Аванс инкассации" в lib/zone-balance.ts).
  if (advance > 0) {
    await prisma.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId,
        type: "collection_advance",
        amount: -advance,
        performedByUserId: owner.user.id,
      },
    });
  }

  dispatchCollection(owner.tenantId, amountNumber + poolDeficit, point.name, null).catch(() => {});

  return NextResponse.json({ ok: true, settledPool: poolDeficit, advance });
}
