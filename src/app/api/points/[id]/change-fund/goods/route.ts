import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Размен для кассы "Товары" (запрос пользователя 2026-07-25: "продавец
// Товаров по идее могут оставить размен") — та же операция, что у зонного
// /api/zones/[id]/change-fund, только не привязана к зоне (Товары —
// точечная касса, см. getPointGoodsCashTotal в lib/zone-balance.ts).
// Абонементам этот роут сознательно не сделан парой — "там нет размена"
// (решение пользователя того же дня): абонементская касса — это только
// суммы, реально оплаченные клиентами, добавлять туда наличные владельца
// "на сдачу" не имеет смысла.
export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/change-fund/goods">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  await prisma.moneyOperation.create({
    data: {
      tenantId: owner.tenantId,
      pointId,
      type: "goods_change_fund",
      amount: amountNumber,
      performedByUserId: owner.user.id,
    },
  });

  return NextResponse.json({ ok: true });
}
