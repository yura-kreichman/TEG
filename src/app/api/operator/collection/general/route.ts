import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getPointPoolDeficit, getZoneBalances } from "@/lib/zone-balance";
import { distributeCollectionWhole } from "@/lib/collection-split";

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
  const amountNumber = Math.round(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zones = await prisma.zone.findMany({ where: { pointId: ctx.point.id } });
  if (zones.length === 0) {
    return NextResponse.json({ error: "На точке нет зон" }, { status: 400 });
  }

  const balanceByZone = await getZoneBalances(zones.map((z) => z.id));
  const weights = zones.map((z) => balanceByZone.get(z.id) ?? 0);
  // Довзыскиваем пул — аванс/премия, уже забранные с точки после прошлой
  // инкассации (см. owner-версию /api/points/[id]/collection/general для
  // причины: иначе эти деньги зависают в журнале зон навсегда).
  const poolDeficit = await getPointPoolDeficit(ctx.point.id);
  const shares = distributeCollectionWhole(amountNumber + poolDeficit, weights);

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
    await prisma.moneyOperation.createMany({ data: rows });
  }

  return NextResponse.json({ ok: true, settledPool: poolDeficit });
}
