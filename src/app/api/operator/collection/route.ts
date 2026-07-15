import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getZonePoolShare } from "@/lib/zone-balance";

// Инкассация: оператор вводит сумму, переданную владельцу; касса уменьшается.
// Подтверждение владельцем не требуется (docs/spec/02-money.md). К введённой
// сумме автоматически прибавляется доля этой зоны в "пуле" — аванс/премия,
// которые сотрудник уже забрал с точки после прошлой инкассации
// (lib/zone-balance.ts, getZonePoolShare) — иначе эти деньги зависают в
// журнале зоны навсегда (решение пользователя 2026-07-16).
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { zoneId, amount } = await request.json();
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, include: { point: true } });
  if (!zone || zone.point.tenantId !== ctx.point.tenantId) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

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

  return NextResponse.json({ ok: true, settledPool: poolShare });
}
