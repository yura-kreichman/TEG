import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Один шаг вперёд: todo -> doing -> done (см. prototype-tasks-v1.html,
// opProgress() — та же однокнопочная механика "Взять в работу"/"Выполнено").
export async function POST(_request: Request, ctx: RouteContext<"/api/operator/tasks/[id]/progress">) {
  const { operator, point } = (await requireOperator()) ?? {};
  if (!operator || !point) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(operator.tenantId, "tasksEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
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
  // CAS вместо обычного update (аудит 2026-07-25, финальный проход) —
  // двойной тап по кнопке "Взять в работу"/"Выполнено" на медленной сети
  // иначе оба запроса читали один и тот же task.status и оба писали ОДИН
  // И ТОТ ЖЕ nextStatus — второй тап молча "терялся" (задача требовала на
  // один тап больше, чем должна), без единой ошибки оператору.
  const claimed = await prisma.task.updateMany({ where: { id, status: task.status }, data: { status: nextStatus } });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Статус задачи уже изменился, обновите страницу" }, { status: 409 });
  }
  return NextResponse.json({ status: nextStatus });
}
