import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Архивная инструкция недоступна по публичной ссылке (docs/spec/07-
// instructions.md) — уже опубликованные записи ознакомлений не трогаются,
// это не удаление истории, только закрытие приёма новых подписаний.
export async function POST(_request: Request, ctx: RouteContext<"/api/instructions/[id]/archive">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const instruction = await prisma.instruction.findUnique({ where: { id } });
  if (!instruction || instruction.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Инструкция не найдена" }, { status: 404 });
  }

  await prisma.instruction.update({ where: { id }, data: { status: "archived" } });
  return NextResponse.json({ ok: true });
}
