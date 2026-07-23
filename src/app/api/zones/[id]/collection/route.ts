import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { getZonePoolShare, settleOutstandingCollectionAdvance } from "@/lib/zone-balance";
import { dispatchCollection } from "@/lib/summary-channels/dispatch";

// Инкассация по конкретной зоне, но вносит владелец (запрос пользователя
// 2026-07-15: "как и у Сотрудника") — та же операция collection, что и у
// оператора (docs/spec/02-money.md), просто выполненная владельцем. К
// введённой сумме автоматически прибавляется доля этой зоны в "пуле" —
// аванс/премия, которые сотрудник уже забрал с точки после прошлой
// инкассации (lib/zone-balance.ts, getZonePoolShare) — иначе эти деньги
// зависают в журнале зоны навсегда (решение пользователя 2026-07-16).
//
// Списывается ПРЯМО, без потолка/"Аванса инкассации" (запрос пользователя
// 2026-07-22, решение после обсуждения: "По зонам" — это ЯВНЫЙ выбор цели
// владельцем, угадывать тут нечего, в отличие от "Общей", где система сама
// решает, на какую зону отнести излишек. Если владелец выбрал именно эту
// зону и ввёл больше её остатка (например, забирает сегодняшнюю, ещё не
// сданную выручку) — уходит в минус честно у НЕЁ, а не в обезличенный
// "Аванс" — так владелец сам видит, какая именно зона "должна" сдать итоги).
// "Аванс инкассации" остаётся только у "Общей" (/api/points/[id]/collection/general) —
// там альтернативы угадыванию нет, деньги реально перемешаны.
export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/collection">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Number(amount);
  // < 0, не <= 0 — 0 допустим: способ вручную запустить погашение
  // накопленного аванса/пула "Общей" инкассации, когда физически новых денег
  // нет (запрос пользователя 2026-07-22).
  if (!Number.isFinite(amountNumber) || amountNumber < 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const actor = { performedByUserId: owner.user.id };

  // Гасим накопленный аванс "Общей" инкассации остатками зон точки, если они
  // уже появились — до расчёта самой этой инкассации (lib/zone-balance.ts,
  // "Аванс инкассации"). Своя отдельная locked-транзакция, уже закоммичена к
  // моменту следующей строки — не конфликтует с локом ниже.
  await settleOutstandingCollectionAdvance(owner.tenantId, zone.pointId, actor);

  // Чтение доли пула и запись collection — единая locked-транзакция (аудит
  // 2026-07-24, тот же гоночный сценарий, что у "Общей" инкассации: без лока
  // два почти одновременных запроса по разным зонам одной точки читают один
  // и тот же getZonePoolShare ДО того, как первый его "погашает", и оба
  // добавляют одну и ту же долю пула — та же точка, что уже 2026-07-25
  // закрыта для settleOutstandingCollectionAdvance/chargeSelfServiceAdvanceToZones).
  const poolShare = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${zone.pointId}))`;

    const poolShare = await getZonePoolShare(zone.pointId, zoneId, tx);
    await tx.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        zoneId,
        type: "collection",
        amount: -(Math.abs(amountNumber) + poolShare),
        performedByUserId: owner.user.id,
      },
    });
    return poolShare;
  });

  // В уведомлении — именно введённая сумма (сколько физически забрали сейчас),
  // не + poolShare: тот довесок не новые деньги, а формальная доразноска по
  // зоне уже забранного раньше аванса/премии (реальный баг, найден
  // пользователем 2026-07-25: push показывал "забрал 955", хотя физически
  // забрали 700, poolShare/poolDeficit добавлялся молча).
  dispatchCollection(owner.tenantId, amountNumber, zone.name, null).catch(() => {});

  return NextResponse.json({ ok: true, settledPool: poolShare });
}
