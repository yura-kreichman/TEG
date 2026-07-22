import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, findTenantPoint } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Вкладка "Остатки" (docs/spec/09-goods.md, "Кабинет владельца") — остаток
// каждого trackStock=true товара на конкретной точке (0, если строки
// GoodsStock ещё нет — остаток ленивый).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");
  const point = pointId ? await findTenantPoint(owner.tenantId, pointId) : null;
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }

  const [goods, stock] = await Promise.all([
    prisma.goods.findMany({
      where: { tenantId: owner.tenantId, deletedAt: null, trackStock: true },
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.goodsStock.findMany({ where: { pointId: point.id } }),
  ]);

  const quantityByGoods = new Map(stock.map((s) => [s.goodsId, s.quantity]));

  return NextResponse.json({
    goods: goods.map((g) => ({
      id: g.id,
      categoryId: g.categoryId,
      name: g.name,
      photoUrl: g.photoUrl,
      lowStockThreshold: g.lowStockThreshold,
      quantity: quantityByGoods.get(g.id) ?? 0,
    })),
  });
}
