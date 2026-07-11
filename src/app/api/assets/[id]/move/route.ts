import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Перемещение актива вверх/вниз внутри своей зоны (фидбек пользователя
// 2026-07-11: владелец должен уметь вручную задать порядок активов — влияет
// на список, форму сдачи итогов, отчёты и сводки). Тот же приём, что у
// /api/operators/[id]/move: меняем местами sortOrder с соседом по текущему
// порядку сортировки в пределах zoneId, не заводя отдельный тенантный scope.
export async function POST(request: Request, ctx: RouteContext<"/api/assets/[id]/move">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: { zone: { include: { point: true } } },
  });
  if (!asset || asset.zone.point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Актив не найден" }, { status: 404 });
  }

  const { direction } = await request.json();
  if (direction !== "up" && direction !== "down") {
    return NextResponse.json({ error: "Некорректное направление" }, { status: 400 });
  }

  const siblings = await prisma.asset.findMany({
    where: { zoneId: asset.zoneId },
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
    prisma.asset.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.asset.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  return NextResponse.json({ ok: true });
}
