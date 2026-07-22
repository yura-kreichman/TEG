import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, findTenantPoint } from "@/lib/require-owner";
import { restockGoods } from "@/lib/goods";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Пополнение остатка — только владелец (docs/spec/09-goods.md, "Остатки"),
// "+N штук" на точку, без закупочных цен.
export async function POST(request: Request, ctx: RouteContext<"/api/goods/[id]/restock">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const goods = await prisma.goods.findFirst({ where: { id, tenantId: owner.tenantId, deletedAt: null } });
  if (!goods) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  }
  if (!goods.trackStock) {
    return NextResponse.json({ error: "У этого товара не ведётся остаток" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const pointId: string = typeof body.pointId === "string" ? body.pointId : "";
  const quantity = Number(body.quantity);

  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "Укажите количество" }, { status: 400 });
  }

  await restockGoods({ tenantId: owner.tenantId, goodsId: id, pointId, quantity, userId: owner.user.id });
  return NextResponse.json({ ok: true });
}
