import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Каталог для раздела "Товары" в ПВА (docs/spec/09-goods.md, "Продажа") —
// только с тумблером goodsAccess (серверная проверка, не только скрытие в
// UI). Сортировка внутри категории — по продажам за 14 дней (запрос
// пользователя: "кэшируемый агрегат, ручной сортировки нет") — считается на
// лету суммированием GoodsSale.quantity за окно; кэш как отдельная
// оптимизация — не блокирует корректность, добавляется отдельно при
// необходимости.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [categories, goods, stock, recentSales] = await Promise.all([
    prisma.goodsCategory.findMany({
      where: { tenantId: ctx.operator.tenantId, deletedAt: null },
      orderBy: { order: "asc" },
    }),
    prisma.goods.findMany({
      where: { tenantId: ctx.operator.tenantId, deletedAt: null },
    }),
    prisma.goodsStock.findMany({
      where: { pointId: ctx.point.id },
    }),
    prisma.goodsSale.groupBy({
      by: ["goodsId"],
      where: { pointId: ctx.point.id, occurredAt: { gte: fourteenDaysAgo }, voidedAt: null },
      _sum: { quantity: true },
    }),
  ]);

  const stockByGoods = new Map(stock.map((s) => [s.goodsId, s.quantity]));
  const popularityByGoods = new Map(recentSales.map((s) => [s.goodsId, s._sum.quantity ?? 0]));

  const goodsSorted = [...goods].sort((a, b) => (popularityByGoods.get(b.id) ?? 0) - (popularityByGoods.get(a.id) ?? 0));

  return NextResponse.json({
    revisionAccess: ctx.operator.revisionAccess,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    goods: goodsSorted.map((g) => ({
      id: g.id,
      categoryId: g.categoryId,
      name: g.name,
      photoUrl: g.photoUrl,
      price: Number(g.price),
      trackStock: g.trackStock,
      stockQuantity: g.trackStock ? (stockByGoods.get(g.id) ?? 0) : null,
      lowStock: g.trackStock && g.lowStockThreshold !== null ? (stockByGoods.get(g.id) ?? 0) <= g.lowStockThreshold : false,
    })),
  });
}
