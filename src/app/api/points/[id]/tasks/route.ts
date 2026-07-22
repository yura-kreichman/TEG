import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { TASK_SELECT, isTaskStatus } from "@/lib/tasks";
import { sendPushToOperators } from "@/lib/push-notifications";
import { isModuleEnabled } from "@/lib/tenant-modules";

export async function GET(_request: Request, ctx: RouteContext<"/api/points/[id]/tasks">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "tasksEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const tasks = await prisma.task.findMany({
    where: { pointId },
    select: TASK_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tasks, pointName: point.name });
}

export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/tasks">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "tasksEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { title, note, assignedOperatorIds, assignedUserIds, status } = await request.json();

  if (typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Название задачи обязательно" }, { status: 400 });
  }
  if (status !== undefined && !isTaskStatus(status)) {
    return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
  }

  const operatorIds = Array.isArray(assignedOperatorIds) ? assignedOperatorIds.filter((v) => typeof v === "string") : [];
  const userIds = Array.isArray(assignedUserIds) ? assignedUserIds.filter((v) => typeof v === "string") : [];

  if (operatorIds.length) {
    const validCount = await prisma.operator.count({ where: { id: { in: operatorIds }, tenantId: owner.tenantId } });
    if (validCount !== operatorIds.length) {
      return NextResponse.json({ error: "Один из операторов не найден" }, { status: 400 });
    }
  }
  if (userIds.length) {
    const validCount = await prisma.user.count({ where: { id: { in: userIds }, tenantId: owner.tenantId } });
    if (validCount !== userIds.length) {
      return NextResponse.json({ error: "Один из пользователей не найден" }, { status: 400 });
    }
  }

  const task = await prisma.task.create({
    data: {
      tenantId: owner.tenantId,
      pointId,
      title: title.trim(),
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      status: isTaskStatus(status) ? status : "todo",
      createdByUserId: owner.user.id,
      assignedOperators: { connect: operatorIds.map((id: string) => ({ id })) },
      assignedUsers: { connect: userIds.map((id: string) => ({ id })) },
    },
    select: TASK_SELECT,
  });

  await notifyOperatorsOfNewTask(owner.tenantId, pointId, operatorIds, task.title);

  return NextResponse.json(task, { status: 201 });
}

// Push-уведомление о новой Задаче (фидбек пользователя 2026-07-14). Кому
// именно слать зависит от назначения — совпадает с правилом видимости
// задачи для Оператора (src/app/api/operator/tasks/route.ts): назначена
// конкретным операторам — только им; иначе ("пусто = видят все операторы")
// адресатов как таковых нет — операторы не привязаны к точке напрямую
// (заходят через устройство точки), поэтому в этом случае уведомляем всех
// активных операторов тенанта с доступом к зонам этой точки (allZonesAccess
// или явный allowedZones на зону точки) — тот же критерий, что уже решает,
// кто "работает" эту точку, для доступа к зонам (операторы/[id]/settings).
async function notifyOperatorsOfNewTask(
  tenantId: string,
  pointId: string,
  assignedOperatorIds: string[],
  taskTitle: string
): Promise<void> {
  let targetOperatorIds = assignedOperatorIds;
  if (targetOperatorIds.length === 0) {
    const operators = await prisma.operator.findMany({
      where: {
        tenantId,
        active: true,
        OR: [{ allZonesAccess: true }, { allowedZones: { some: { pointId } } }],
      },
      select: { id: true },
    });
    targetOperatorIds = operators.map((o) => o.id);
  }
  await sendPushToOperators(targetOperatorIds, {
    title: "🗒️ Новая задача",
    body: taskTitle,
    url: "/operator",
  });
}
