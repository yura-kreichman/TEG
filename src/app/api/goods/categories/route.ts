import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Категории товаров (docs/spec/09-goods.md, "Каталог") — создаёт владелец,
// общие на тенант. Тот же CRUD-паттерн, что /api/abonements.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const categories = await prisma.goodsCategory.findMany({
    where: { tenantId: owner.tenantId, deletedAt: null },
    orderBy: { order: "asc" },
  });

  return NextResponse.json({ categories: categories.map((c) => ({ id: c.id, name: c.name, order: c.order })) });
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
  const name: string = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Укажите название категории" }, { status: 400 });
  }

  const count = await prisma.goodsCategory.count({ where: { tenantId: owner.tenantId, deletedAt: null } });
  const category = await prisma.goodsCategory.create({
    data: { tenantId: owner.tenantId, name, order: count },
  });

  return NextResponse.json({ id: category.id, name: category.name, order: category.order }, { status: 201 });
}
