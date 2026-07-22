import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { TASK_SELECT, isTaskStatus } from "@/lib/tasks";
import { isModuleEnabled } from "@/lib/tenant-modules";

async function findTenantTask(tenantId: string, taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.tenantId !== tenantId) return null;
  return task;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "tasksEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const task = await findTenantTask(owner.tenantId, id);
  if (!task) {
    return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  }

  const { title, note, status, assignedOperatorIds, assignedUserIds } = await request.json();
  const data: {
    title?: string;
    note?: string | null;
    status?: string;
    assignedOperators?: { set: { id: string }[] };
    assignedUsers?: { set: { id: string }[] };
  } = {};

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Название задачи обязательно" }, { status: 400 });
    }
    data.title = title.trim();
  }
  if (note !== undefined) {
    data.note = typeof note === "string" && note.trim() ? note.trim() : null;
  }
  if (status !== undefined) {
    if (!isTaskStatus(status)) {
      return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
    }
    data.status = status;
  }
  if (assignedOperatorIds !== undefined) {
    if (!Array.isArray(assignedOperatorIds) || !assignedOperatorIds.every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "Некорректный список операторов" }, { status: 400 });
    }
    const validCount = assignedOperatorIds.length
      ? await prisma.operator.count({ where: { id: { in: assignedOperatorIds }, tenantId: owner.tenantId } })
      : 0;
    if (validCount !== assignedOperatorIds.length) {
      return NextResponse.json({ error: "Один из операторов не найден" }, { status: 400 });
    }
    data.assignedOperators = { set: assignedOperatorIds.map((opId: string) => ({ id: opId })) };
  }
  if (assignedUserIds !== undefined) {
    if (!Array.isArray(assignedUserIds) || !assignedUserIds.every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "Некорректный список пользователей" }, { status: 400 });
    }
    const validCount = assignedUserIds.length
      ? await prisma.user.count({ where: { id: { in: assignedUserIds }, tenantId: owner.tenantId } })
      : 0;
    if (validCount !== assignedUserIds.length) {
      return NextResponse.json({ error: "Один из пользователей не найден" }, { status: 400 });
    }
    data.assignedUsers = { set: assignedUserIds.map((uId: string) => ({ id: uId })) };
  }

  const updated = await prisma.task.update({ where: { id }, data, select: TASK_SELECT });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "tasksEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const task = await findTenantTask(owner.tenantId, id);
  if (!task) {
    return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  }

  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
