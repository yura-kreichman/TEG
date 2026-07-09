import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Один шаг вперёд: todo -> doing -> done (см. prototype-tasks-v1.html,
// opProgress() — та же однокнопочная механика "Взять в работу"/"Выполнено").
export async function POST(_request: Request, ctx: RouteContext<"/api/operator/tasks/[id]/progress">) {
  const { operator, point } = (await requireOperator()) ?? {};
  if (!operator || !point) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { assignedOperators: { select: { id: true } } },
  });
  if (!task || task.pointId !== point.id) {
    return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  }
  const visible = task.assignedOperators.length === 0 || task.assignedOperators.some((o) => o.id === operator.id);
  if (!visible) {
    return NextResponse.json({ error: "Задача не назначена вам" }, { status: 403 });
  }

  const nextStatus = task.status === "todo" ? "doing" : "done";
  const updated = await prisma.task.update({ where: { id }, data: { status: nextStatus } });
  return NextResponse.json({ status: updated.status });
}
