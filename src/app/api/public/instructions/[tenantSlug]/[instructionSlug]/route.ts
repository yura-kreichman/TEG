import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { estimateReadingMinutes, type PMNode } from "@/lib/instructions/content";

// Публичный, без авторизации (docs/spec/07-instructions.md). Резолвит
// тенанта и инструкцию ОДНИМ запросом по обоим slug'ам сразу — не палит,
// какая часть не совпала (несуществующий tenant-slug, черновик, архив —
// один и тот же 404 "not_found", без деталей, см. Шаг 2).
export async function GET(_request: Request, ctx: RouteContext<"/api/public/instructions/[tenantSlug]/[instructionSlug]">) {
  const { tenantSlug, instructionSlug } = await ctx.params;

  const instruction = await prisma.instruction.findFirst({
    where: { slug: instructionSlug, status: "published", tenant: { slug: tenantSlug } },
    include: { tenant: { select: { name: true, instructionsEnabled: true } } },
  });
  // Модуль выключен владельцем (Настройки → Система → "Модули") — тот же
  // not_found, что для несуществующей/архивной инструкции, без деталей.
  if (!instruction || !instruction.tenant.instructionsEnabled) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const version = await prisma.instructionVersion.findFirst({
    where: { instructionId: instruction.id },
    orderBy: { versionNumber: "desc" },
  });
  if (!version) {
    // Теоретически недостижимо (published всегда создаётся вместе с версией
    // в той же транзакции публикации), но не доверяем этому инварианту молча.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    tenantName: instruction.tenant.name,
    title: version.title,
    content: version.content,
    versionId: version.id,
    honestyCheck: instruction.honestyCheck,
    readingMinutes: estimateReadingMinutes(version.content as unknown as PMNode),
  });
}
