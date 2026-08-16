import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

// Перемещение зоны вверх/вниз внутри своей точки (запрос владельца
// 2026-08-16: "владелец должен иметь возможность менять порядок зон, как уже
// сделано у Активов"). Порядок сквозной: Итоги дня, дропдауны у владельца и в
// PWA, разбивка по зонам в сводках и инкассациях, остатки по кассам, лендинг.
//
// Тот же приём, что у /api/assets/[id]/move: меняем местами sortOrder с
// соседом по текущему порядку сортировки в пределах точки. Неактивные зоны из
// списка НЕ исключаются — иначе после включения зона всплывала бы в
// произвольном месте.
export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/move">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zone = await prisma.zone.findUnique({ where: { id }, include: { point: true } });
  if (!zone || zone.point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const { direction } = await request.json();
  if (direction !== "up" && direction !== "down") {
    return NextResponse.json({ error: "Некорректное направление" }, { status: 400 });
  }

  const siblings = await prisma.zone.findMany({
    where: { pointId: zone.pointId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, sortOrder: true },
  });
  const index = siblings.findIndex((s) => s.id === id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= siblings.length) {
    return NextResponse.json({ ok: true }); // уже крайняя — не ошибка, просто нет соседа
  }

  const current = siblings[index];
  const neighbor = siblings[swapIndex];
  // Одинаковый sortOrder у соседей (данные до миграции/после ручных правок)
  // обмен местами не сдвинул бы вовсе — в этом случае раздаём позиции заново
  // по текущему порядку и уже потом меняем пару.
  if (current.sortOrder === neighbor.sortOrder) {
    await prisma.$transaction(
      siblings.map((s, i) => prisma.zone.update({ where: { id: s.id }, data: { sortOrder: i } }))
    );
    await prisma.$transaction([
      prisma.zone.update({ where: { id: current.id }, data: { sortOrder: swapIndex } }),
      prisma.zone.update({ where: { id: neighbor.id }, data: { sortOrder: index } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.zone.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } }),
      prisma.zone.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } }),
    ]);
  }

  // Лендинг перечисляет зоны в том же порядке (lib/landing/get-render-data.ts),
  // а страница статическая — без ревалидации новый порядок доехал бы туда
  // только со следующей несвязанной правкой (та же грабля, что у активов).
  await revalidateLandingForTenant(owner.tenantId);

  return NextResponse.json({ ok: true });
}
