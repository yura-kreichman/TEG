import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { validateInstructionContent } from "@/lib/instructions/content";
import type { Prisma } from "@/generated/prisma/client";

async function loadInstruction(id: string, tenantId: string) {
  const instruction = await prisma.instruction.findUnique({ where: { id } });
  if (!instruction || instruction.tenantId !== tenantId) return null;
  return instruction;
}

export async function GET(_request: Request, ctx: RouteContext<"/api/instructions/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const instruction = await loadInstruction(id, owner.tenantId);
  if (!instruction) {
    return NextResponse.json({ error: "Инструкция не найдена" }, { status: 404 });
  }

  return NextResponse.json({
    id: instruction.id,
    title: instruction.title,
    content: instruction.content,
    slug: instruction.slug,
    status: instruction.status,
    honestyCheck: instruction.honestyCheck,
    currentVersionNumber: instruction.currentVersionNumber,
  });
}

// Правка Instruction.title/content — это ТЕКУЩИЙ РЕДАКТИРУЕМЫЙ черновик, не
// опубликованная версия (см. docs/spec/07-instructions.md, Шаг 2). Публичная
// страница ничего из этого не видит, пока не вызван /publish.
export async function PATCH(request: Request, ctx: RouteContext<"/api/instructions/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const instruction = await loadInstruction(id, owner.tenantId);
  if (!instruction) {
    return NextResponse.json({ error: "Инструкция не найдена" }, { status: 404 });
  }
  if (instruction.status === "archived") {
    return NextResponse.json({ error: "Архивная инструкция недоступна для правки" }, { status: 409 });
  }

  const { title, content, honestyCheck } = await request.json();
  const data: Prisma.InstructionUpdateInput = {};

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Некорректное название" }, { status: 400 });
    }
    data.title = title.trim();
  }
  if (content !== undefined) {
    if (!validateInstructionContent(content)) {
      return NextResponse.json({ error: "Недопустимый формат контента" }, { status: 400 });
    }
    data.content = content as unknown as Prisma.InputJsonValue;
  }
  if (honestyCheck !== undefined) {
    if (typeof honestyCheck !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.honestyCheck = honestyCheck;
  }

  await prisma.instruction.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

// Полное удаление — только пока нет ни одной записи ознакомления (решение
// пользователя 2026-07-13): AcknowledgmentRecord каскадируется на
// Instruction (onDelete: Cascade), а это подписанные документы (ФИО, PNG-
// подпись, IP) — терять их безвозвратно нельзя. Для уже подписанных
// инструкций остаётся только архивация (см. /archive).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/instructions/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const instruction = await loadInstruction(id, owner.tenantId);
  if (!instruction) {
    return NextResponse.json({ error: "Инструкция не найдена" }, { status: 404 });
  }

  const recordCount = await prisma.acknowledgmentRecord.count({ where: { instructionId: id } });
  if (recordCount > 0) {
    return NextResponse.json(
      { error: "Инструкцию уже подписали сотрудники — удаление недоступно, используйте архивацию" },
      { status: 409 }
    );
  }

  await prisma.instruction.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
