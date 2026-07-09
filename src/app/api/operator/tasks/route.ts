import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Оператор видит задачи своей точки, где либо нет ни одного назначенного
// (оператора/пользователя) — "пусто = видят все операторы" (см.
// prototype-tasks-v1.html), либо он сам в списке назначенных операторов.
// Назначение на владельца (assignedUsers) не влияет на видимость у оператора.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const tasks = await prisma.task.findMany({
    where: {
      pointId: point.id,
      status: { not: "done" },
      OR: [
        { assignedOperators: { none: {} }, assignedUsers: { none: {} } },
        { assignedOperators: { some: { id: operator.id } } },
      ],
    },
    select: { id: true, title: true, note: true, status: true, assignedOperators: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });

  const doneToday = await prisma.task.count({
    where: {
      pointId: point.id,
      status: "done",
      OR: [
        { assignedOperators: { none: {} }, assignedUsers: { none: {} } },
        { assignedOperators: { some: { id: operator.id } } },
      ],
      updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      note: t.note,
      status: t.status,
      shared: t.assignedOperators.length === 0,
    })),
    doneToday,
  });
}
