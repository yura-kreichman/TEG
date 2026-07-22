import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { dispatchCollection } from "@/lib/summary-channels/dispatch";

// Инкассация "Абонементы"/"Товары" наличными точки — явный выбор цели в
// дропдауне "По зонам" (запрос пользователя 2026-07-22, решение после
// обсуждения: "мне кажется что в этот dropdown надо давать абонементы и
// товары... чтобы Владелец в минус мог забрать деньги пока не внесли их
// итоги"). Эти деньги не привязаны ни к одной зоне (lib/zone-balance.ts,
// getPointAbonementCashTotal/getPointGoodsCashTotal), поэтому свой роут, не
// /api/zones/[id]/collection. Списывается ПРЯМО, без потолка — тот же
// принцип, что и у обычной зонной инкассации теперь: явный выбор цели не
// требует угадывания, честно уходит в минус у этой же цели, если забрано
// больше учтённого (см. /api/zones/[id]/collection для полного объяснения).
export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/collection/pool">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { pool, amount } = await request.json();
  if (pool !== "abonement" && pool !== "goods") {
    return NextResponse.json({ error: "Некорректный пул" }, { status: 400 });
  }
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  await prisma.moneyOperation.create({
    data: {
      tenantId: owner.tenantId,
      pointId,
      type: pool === "abonement" ? "collection_pool_sweep_abonement" : "collection_pool_sweep_goods",
      amount: -amountNumber,
      performedByUserId: owner.user.id,
    },
  });

  dispatchCollection(owner.tenantId, amountNumber, point.name, null).catch(() => {});

  return NextResponse.json({ ok: true });
}
