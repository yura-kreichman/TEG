import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Незавершённые задачи всего тенанта — источник badge-точки на "Ещё" в
// нижнем баре кабинета владельца (docs/spec/03-design-system.md, НАВИГАЦИЯ:
// "badge-точка... если внутри есть пункты с активными событиями, например
// невыполненные задачи").
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const count = await prisma.task.count({ where: { tenantId: owner.tenantId, status: { not: "done" } } });
  return NextResponse.json({ count });
}
