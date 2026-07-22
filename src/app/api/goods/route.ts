import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Каталог товаров (docs/spec/09-goods.md, "Каталог") — общий на тенант,
// владелец создаёт/редактирует. Позиций 100+ — сортировка по order, как у
// активов/тарифов.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const goods = await prisma.goods.findMany({
    where: { tenantId: owner.tenantId, deletedAt: null },
    orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
  });

  // Актуальное количество в Каталоге (запрос пользователя 2026-07-19) — эта
  // вкладка не привязана к точке, поэтому это сумма остатков по всем точкам
  // тенанта, а не остаток на конкретной точке (тот показывается в "Остатки").
  const stockSums = await prisma.goodsStock.groupBy({
    by: ["goodsId"],
    where: { goods: { tenantId: owner.tenantId } },
    _sum: { quantity: true },
  });
  const quantityByGoodsId = new Map(stockSums.map((s) => [s.goodsId, s._sum.quantity ?? 0]));

  return NextResponse.json({
    goods: goods.map((g) => ({
      id: g.id,
      categoryId: g.categoryId,
      name: g.name,
      photoUrl: g.photoUrl,
      price: Number(g.price),
      lowStockThreshold: g.lowStockThreshold,
      trackStock: g.trackStock,
      active: g.active,
      sortOrder: g.sortOrder,
      quantity: g.trackStock ? quantityByGoodsId.get(g.id) ?? 0 : null,
    })),
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const categoryId: string = typeof body.categoryId === "string" ? body.categoryId : "";
  const name: string = typeof body.name === "string" ? body.name.trim() : "";
  const price = Number(body.price);
  const photoUrl: string | null = typeof body.photoUrl === "string" && body.photoUrl ? body.photoUrl : null;
  const lowStockThreshold: number | null =
    body.lowStockThreshold === null || body.lowStockThreshold === undefined || body.lowStockThreshold === ""
      ? null
      : Number(body.lowStockThreshold);
  const trackStock: boolean = body.trackStock !== false;

  if (!name) {
    return NextResponse.json({ error: "Укажите название товара" }, { status: 400 });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: "Укажите цену товара" }, { status: 400 });
  }
  if (lowStockThreshold !== null && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
    return NextResponse.json({ error: "Некорректный порог низкого остатка" }, { status: 400 });
  }

  const category = await prisma.goodsCategory.findFirst({
    where: { id: categoryId, tenantId: owner.tenantId, deletedAt: null },
  });
  if (!category) {
    return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
  }

  const count = await prisma.goods.count({ where: { tenantId: owner.tenantId, categoryId, deletedAt: null } });
  const goods = await prisma.goods.create({
    data: { tenantId: owner.tenantId, categoryId, name, photoUrl, price, lowStockThreshold, trackStock, sortOrder: count },
  });

  return NextResponse.json(
    {
      id: goods.id,
      categoryId: goods.categoryId,
      name: goods.name,
      photoUrl: goods.photoUrl,
      price: Number(goods.price),
      lowStockThreshold: goods.lowStockThreshold,
      trackStock: goods.trackStock,
    },
    { status: 201 }
  );
}
