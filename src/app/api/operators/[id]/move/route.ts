import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";

// Перемещение оператора вверх/вниз в списке (фидбек пользователя 2026-07-11:
// владелец должен уметь вручную задать порядок операторов — влияет на список,
// отчёты и сводки). Меняет местами sortOrder с соседом по текущему порядку
// сортировки (не по значению sortOrder напрямую — так корректно работает и
// при дублирующихся/несмежных значениях после ручных правок в БД).
export async function POST(request: Request, ctx: RouteContext<"/api/operators/[id]/move">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { direction } = await request.json();
  if (direction !== "up" && direction !== "down") {
    return NextResponse.json({ error: "Некорректное направление" }, { status: 400 });
  }

  const siblings = await prisma.operator.findMany({
    where: { tenantId: owner.tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, sortOrder: true },
  });
  const index = siblings.findIndex((s) => s.id === id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= siblings.length) {
    return NextResponse.json({ ok: true }); // уже крайний в списке — не ошибка, просто нет соседа
  }

  const current = siblings[index];
  const neighbor = siblings[swapIndex];
  await prisma.$transaction([
    prisma.operator.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.operator.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  return NextResponse.json({ ok: true });
}
