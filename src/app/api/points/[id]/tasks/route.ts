import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isTaskStatus } from "@/lib/tasks";

async function findTenantPoint(tenantId: string, pointId: string) {
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== tenantId) return null;
  return point;
}

const TASK_SELECT = {
  id: true,
  title: true,
  note: true,
  status: true,
  createdAt: true,
  assignedOperators: { select: { id: true, name: true, colorTag: true } },
  assignedUsers: { select: { id: true, email: true } },
} as const;

export async function GET(_request: Request, ctx: RouteContext<"/api/points/[id]/tasks">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
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

  return NextResponse.json(task, { status: 201 });
}
