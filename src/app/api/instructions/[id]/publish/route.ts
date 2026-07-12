import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { validateInstructionContent } from "@/lib/instructions/content";
import type { Prisma } from "@/generated/prisma/client";

// Публикация (docs/spec/07-instructions.md, "Версии") — снимает immutable
// snapshot текущего черновика в новую InstructionVersion и переключает
// статус на published. Повторная публикация уже опубликованной инструкции
// (после правки) создаёт версию N+1, не перезаписывает предыдущую.
export async function POST(_request: Request, ctx: RouteContext<"/api/instructions/[id]/publish">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const instruction = await prisma.instruction.findUnique({ where: { id } });
  if (!instruction || instruction.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Инструкция не найдена" }, { status: 404 });
  }
  if (instruction.status === "archived") {
    return NextResponse.json({ error: "Архивная инструкция не может быть опубликована" }, { status: 409 });
  }
  if (!validateInstructionContent(instruction.content)) {
    return NextResponse.json({ error: "Контент повреждён, публикация невозможна" }, { status: 400 });
  }

  const nextVersionNumber = instruction.currentVersionNumber + 1;

  await prisma.$transaction([
    prisma.instructionVersion.create({
      data: {
        instructionId: instruction.id,
        versionNumber: nextVersionNumber,
        title: instruction.title,
        content: instruction.content as Prisma.InputJsonValue,
      },
    }),
    prisma.instruction.update({
      where: { id: instruction.id },
      data: { status: "published", currentVersionNumber: nextVersionNumber },
    }),
  ]);

  return NextResponse.json({ ok: true, versionNumber: nextVersionNumber });
}
