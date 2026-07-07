import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

export async function PATCH(request: Request, ctx: RouteContext<"/api/points/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { name, address, iconKey } = await request.json();
  const data: { name?: string; address?: string | null; iconKey?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название точки обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (address !== undefined) {
    data.address = typeof address === "string" && address.trim() ? address.trim() : null;
  }
  if (iconKey !== undefined) {
    data.iconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
  }

  await prisma.point.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/points/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  // A Point referenced by historical records (results submissions / money
  // operations on its zones) can't be hard-deleted without silently losing
  // that history via cascade — same guard as Operator deletion.
  const [submissionCount, moneyOpCount] = await Promise.all([
    prisma.resultsSubmission.count({ where: { pointId: id } }),
    prisma.moneyOperation.count({ where: { zone: { pointId: id } } }),
  ]);
  if (submissionCount > 0 || moneyOpCount > 0) {
    return NextResponse.json(
      { error: "У этой точки есть история сдач итогов/операций — её нельзя удалить." },
      { status: 409 }
    );
  }

  await prisma.point.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
