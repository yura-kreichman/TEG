import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const categories = await prisma.expenseCategory.findMany({
    where: { tenantId: owner.tenantId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { name } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название категории обязательно" }, { status: 400 });
  }

  const count = await prisma.expenseCategory.count({ where: { tenantId: owner.tenantId } });
  const category = await prisma.expenseCategory.create({
    data: { tenantId: owner.tenantId, name: name.trim(), sortOrder: count },
  });

  return NextResponse.json({ id: category.id, name: category.name }, { status: 201 });
}
