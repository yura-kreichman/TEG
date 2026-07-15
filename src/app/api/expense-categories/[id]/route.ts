import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

async function findOwnedCategory(tenantId: string, id: string) {
  const category = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!category || category.tenantId !== tenantId) return null;
  return category;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/expense-categories/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const category = await findOwnedCategory(owner.tenantId, id);
  if (!category) {
    return NextResponse.json({ error: "Категория не найдена" }, { status: 404 });
  }

  const { name } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название категории обязательно" }, { status: 400 });
  }

  await prisma.expenseCategory.update({ where: { id }, data: { name: name.trim() } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/expense-categories/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const category = await findOwnedCategory(owner.tenantId, id);
  if (!category) {
    return NextResponse.json({ error: "Категория не найдена" }, { status: 404 });
  }

  // Записи расхода с этой категорией не блокируют удаление — ExpenseEntry.categoryId
  // onDelete: SetNull в schema.prisma, они просто станут "без категории".
  await prisma.expenseCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
