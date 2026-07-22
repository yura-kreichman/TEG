import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

async function findOwnedCategory(tenantId: string, id: string) {
  const category = await prisma.goodsCategory.findUnique({ where: { id } });
  if (!category || category.tenantId !== tenantId || category.deletedAt) return null;
  return category;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/goods/categories/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const category = await findOwnedCategory(owner.tenantId, id);
  if (!category) {
    return NextResponse.json({ error: "Категория не найдена" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const name: string = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Укажите название категории" }, { status: 400 });
  }

  await prisma.goodsCategory.update({ where: { id }, data: { name } });
  return NextResponse.json({ ok: true });
}

// Мягкое удаление (тот же принцип, что Tariff/Abonement) — прошлые Goods
// должны продолжать ссылаться на категорию, к которой когда-то относились.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/goods/categories/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const category = await findOwnedCategory(owner.tenantId, id);
  if (!category) {
    return NextResponse.json({ error: "Категория не найдена" }, { status: 404 });
  }

  const activeGoodsCount = await prisma.goods.count({ where: { categoryId: id, deletedAt: null } });
  if (activeGoodsCount > 0) {
    return NextResponse.json({ error: "В категории есть товары — сначала перенесите или архивируйте их" }, { status: 400 });
  }

  await prisma.goodsCategory.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
