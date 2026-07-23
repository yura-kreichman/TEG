import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";

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
  if (!(await isModuleEnabled(operator.tenantId, "tasksEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const tasks = await prisma.task.findMany({
    where: {
      pointId: point.id,
      status: { not: "done" },
      // assignedUsers (назначение на владельца, галочка "это моё" в форме) НЕ
      // влияет на видимость у оператора вообще — только assignedOperators
      // (см. комментарий выше). Реальный баг, найден аудитом 2026-07-24:
      // условие раньше требовало ОБА списка пустыми для ветки "видят все",
      // из-за чего задача, назначенная владельцем на себя без назначенного
      // оператора, полностью пропадала у операторов — противоречило
      // собственному комментарию файла и логике /progress-роута ниже,
      // который проверяет только assignedOperators.
      OR: [{ assignedOperators: { none: {} } }, { assignedOperators: { some: { id: operator.id } } }],
    },
    select: { id: true, title: true, note: true, status: true, assignedOperators: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });

  const doneToday = await prisma.task.count({
    where: {
      pointId: point.id,
      status: "done",
      // assignedUsers (назначение на владельца, галочка "это моё" в форме) НЕ
      // влияет на видимость у оператора вообще — только assignedOperators
      // (см. комментарий выше). Реальный баг, найден аудитом 2026-07-24:
      // условие раньше требовало ОБА списка пустыми для ветки "видят все",
      // из-за чего задача, назначенная владельцем на себя без назначенного
      // оператора, полностью пропадала у операторов — противоречило
      // собственному комментарию файла и логике /progress-роута ниже,
      // который проверяет только assignedOperators.
      OR: [{ assignedOperators: { none: {} } }, { assignedOperators: { some: { id: operator.id } } }],
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
