import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Незавершённые задачи всего тенанта — источник badge-точки на "Ещё" в
// нижнем баре кабинета владельца (docs/spec/03-design-system.md, НАВИГАЦИЯ:
// "badge-точка... если внутри есть пункты с активными событиями, например
// невыполненные задачи"). Раздельные todo/doing — точка красная, если есть
// новая (ещё не взятая в работу) задача, зелёная, если есть только "в
// работе" (запрос пользователя 2026-07-17), и пропадает вовсе, когда всё
// выполнено.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const [todoCount, doingCount] = await Promise.all([
    prisma.task.count({ where: { tenantId: owner.tenantId, status: "todo" } }),
    prisma.task.count({ where: { tenantId: owner.tenantId, status: "doing" } }),
  ]);
  return NextResponse.json({ count: todoCount + doingCount, todoCount, doingCount });
}
