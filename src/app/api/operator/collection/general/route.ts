import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
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

// Общая инкассация (запрос пользователя 2026-07-15): к моменту, когда
// владелец приходит собирать деньги, наличные всех зон точки часто уже
// физически лежат одной стопкой — разложить обратно по зонам невозможно.
// Оператор вводит один общий итог, сервер сам делит его между зонами точки
// пропорционально их текущему остатку и пишет обычные zone-level операции
// collection — остальной код (отчёты, /money/zone-balances, сводки) не
// меняется, он просто видит несколько обычных инкассаций вместо одной.
// Разбивка — distributeCollectionWhole (см. lib/collection-split.ts), общая
// с owner-версией (/api/points/[id]/collection/general).

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { amount } = await request.json();
  // Округление до копеек, не до целого рубля (аудит 2026-07-24, см.
  // owner-версию /api/points/[id]/collection/general для полного разбора).
  const amountNumber = Math.round(Number(amount) * 100) / 100;
  // < 0, не <= 0 — 0 допустим: способ вручную запустить погашение
  // накопленного аванса/пула, когда физически новых денег нет (запрос
  // пользователя 2026-07-22).
  if (!Number.isFinite(amountNumber) || amountNumber < 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zones = await prisma.zone.findMany({ where: { pointId: ctx.point.id } });
  if (zones.length === 0) {
    return NextResponse.json({ error: "На точке нет зон" }, { status: 400 });
  }

  const actor = { performedByOperatorId: ctx.operator.id };

  // Сначала гасим накопленный аванс инкассации остатками зон точки, если они
  // уже появились (lib/zone-balance.ts, "Аванс инкассации"). Своя отдельная
  // locked-транзакция, уже закоммичена к моменту следующей строки —
  // последовательные, не вложенные транзакции, лок не конфликтует.
  await settleOutstandingCollectionAdvance(ctx.point.tenantId, ctx.point.id, actor);

  // Чтение остатков зон/пулов и запись collection — единая locked-транзакция
  // (аудит 2026-07-24, тот же гоночный сценарий, что и в owner-версии
  // /api/points/[id]/collection/general: двойной клик или гонка владелец+
  // оператор на одной точке читали одни и те же остатки до того, как первый
  // запрос успевал их списать).
  const { poolDeficit, advance } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.point.id}))`;

    const balanceByZone = await getZoneBalances(
      zones.map((z) => z.id),
      tx
    );
    const weights = zones.map((z) => balanceByZone.get(z.id) ?? 0);
    const zonesRawSum = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    // Довзыскиваем пул — аванс/премия, уже забранные с точки после прошлой
    // инкассации (см. owner-версию /api/points/[id]/collection/general для
    // причины: иначе эти деньги зависают в журнале зон навсегда).
    const poolDeficit = await getPointPoolDeficit(ctx.point.id, tx);
    // Сколько из "сырого" остатка зон РЕАЛЬНО свободно для новой инкассации —
    // не весь zonesRawSum, а за вычетом poolDeficit (реальный баг, найден
    // пользователем 2026-07-25 — см. owner-версию для полного разбора: тот же
    // остаток зон одновременно шёл и в zonePortion, и отдельно довзыскивался
    // как poolDeficit — одни и те же деньги списывались с зон дважды).
    const zonesAvailable = Math.max(0, zonesRawSum - poolDeficit);
    // Абонементы и товары наличными — не привязаны ни к одной зоне, и друг с
    // другом не смешиваются (см. owner-версию: "могут быть и 2 пачки"). Разный
    // учёт, одна инкассация — свои части разбивки.
    const [abonementCash, goodsCash] = await Promise.all([
      getPointAbonementCashTotal(ctx.point.id, tx),
      getPointGoodsCashTotal(ctx.point.id, tx),
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
        tenantId: ctx.point.tenantId,
        zoneId: zone.id,
        type: "collection",
        amount: -Math.abs(shares[i]),
        performedByOperatorId: ctx.operator.id,
      }))
      .filter((row) => row.amount !== 0);

    if (rows.length > 0) {
      await tx.moneyOperation.createMany({ data: rows });
    }
    // Абонементы/товары наличными — реальной суммой, СВОИМ типом каждый, в
    // Реестр инкассаций раздельными строками (см. owner-версию для полного
    // объяснения).
    if (abonementSweepPortion > 0) {
      await tx.moneyOperation.create({
        data: {
          tenantId: ctx.point.tenantId,
          pointId: ctx.point.id,
          type: "collection_pool_sweep_abonement",
          amount: -abonementSweepPortion,
          performedByOperatorId: ctx.operator.id,
        },
      });
    }
    if (goodsSweepPortion > 0) {
      await tx.moneyOperation.create({
        data: {
          tenantId: ctx.point.tenantId,
          pointId: ctx.point.id,
          type: "collection_pool_sweep_goods",
          amount: -goodsSweepPortion,
          performedByOperatorId: ctx.operator.id,
        },
      });
    }
    if (advance > 0) {
      await tx.moneyOperation.create({
        data: {
          tenantId: ctx.point.tenantId,
          pointId: ctx.point.id,
          type: "collection_advance",
          amount: -advance,
          performedByOperatorId: ctx.operator.id,
        },
      });
    }

    return { poolDeficit, advance };
  });

  // В уведомлении — именно введённая сумма (см. комментарий у той же строки в
  // /api/zones/[id]/collection — тот же баг, найден пользователем 2026-07-25).
  dispatchCollection(ctx.point.tenantId, amountNumber, ctx.point.name, ctx.operator.name).catch(() => {});

  return NextResponse.json({ ok: true, settledPool: poolDeficit, advance });
}
