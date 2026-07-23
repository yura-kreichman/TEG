import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getZonePoolShare, settleOutstandingCollectionAdvance } from "@/lib/zone-balance";
import { dispatchCollection } from "@/lib/summary-channels/dispatch";

// Инкассация: оператор вводит сумму, переданную владельцу; касса уменьшается.
// Подтверждение владельцем не требуется (docs/spec/02-money.md). К введённой
// сумме автоматически прибавляется доля этой зоны в "пуле" — аванс/премия,
// которые сотрудник уже забрал с точки после прошлой инкассации
// (lib/zone-balance.ts, getZonePoolShare) — иначе эти деньги зависают в
// журнале зоны навсегда (решение пользователя 2026-07-16).
//
// Списывается ПРЯМО, без потолка/"Аванса инкассации" — см. owner-версию
// (/api/zones/[id]/collection) для полного объяснения решения 2026-07-22.
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { zoneId, amount } = await request.json();
  const amountNumber = Number(amount);
  // < 0, не <= 0 — 0 допустим: способ вручную запустить погашение
  // накопленного аванса/пула "Общей" инкассации, когда физически новых денег
  // нет (запрос пользователя 2026-07-22).
  if (!Number.isFinite(amountNumber) || amountNumber < 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, include: { point: true } });
  if (!zone || zone.point.tenantId !== ctx.point.tenantId) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const actor = { performedByOperatorId: ctx.operator.id };

  // Гасим накопленный аванс "Общей" инкассации остатками зон точки, если они
  // уже появились (lib/zone-balance.ts, "Аванс инкассации").
  await settleOutstandingCollectionAdvance(ctx.point.tenantId, zone.pointId, actor);

  const poolShare = await getZonePoolShare(zone.pointId, zoneId);
  await prisma.moneyOperation.create({
    data: {
      tenantId: ctx.point.tenantId,
      zoneId,
      type: "collection",
      amount: -(Math.abs(amountNumber) + poolShare),
      performedByOperatorId: ctx.operator.id,
    },
  });

  // В уведомлении — именно введённая сумма (см. комментарий у той же строки в
  // /api/zones/[id]/collection — тот же баг, найден пользователем 2026-07-25).
  dispatchCollection(ctx.point.tenantId, amountNumber, zone.name, ctx.operator.name).catch(() => {});

  return NextResponse.json({ ok: true, settledPool: poolShare });
}
