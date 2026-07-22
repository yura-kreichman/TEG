import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { isModuleEnabled } from "@/lib/tenant-modules";

async function findOwnedGoods(tenantId: string, id: string) {
  const goods = await prisma.goods.findUnique({ where: { id } });
  if (!goods || goods.tenantId !== tenantId || goods.deletedAt) return null;
  return goods;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/goods/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const goods = await findOwnedGoods(owner.tenantId, id);
  if (!goods) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  // Частичное обновление (тот же приём, что /api/points/[id]) — запрос
  // пользователя 2026-07-22: быстрый тап по иконке статуса шлёт только
  // {active}, без остальных полей формы редактирования.
  if (Object.keys(body).length === 1 && typeof body.active === "boolean") {
    await prisma.goods.update({ where: { id }, data: { active: body.active } });
    return NextResponse.json({ ok: true });
  }

  const categoryId: string = typeof body.categoryId === "string" ? body.categoryId : goods.categoryId;
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
  if (categoryId !== goods.categoryId) {
    const category = await prisma.goodsCategory.findFirst({
      where: { id: categoryId, tenantId: owner.tenantId, deletedAt: null },
    });
    if (!category) {
      return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
    }
  }

  // Старое фото больше не нужно — заменяется новым/убирается (тот же приём,
  // что у Asset/Operator).
  if (goods.photoUrl && goods.photoUrl !== photoUrl) {
    await deleteUploadedImage(goods.photoUrl);
  }

  await prisma.goods.update({
    where: { id },
    data: { categoryId, name, photoUrl, price, lowStockThreshold, trackStock },
  });
  return NextResponse.json({ ok: true });
}

// Мягкое удаление (тот же принцип, что Tariff/Abonement) — прошлые
// GoodsSale/GoodsStock должны продолжать ссылаться на товар.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/goods/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const goods = await findOwnedGoods(owner.tenantId, id);
  if (!goods) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  }

  await prisma.goods.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
