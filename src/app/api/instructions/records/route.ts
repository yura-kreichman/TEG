import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { estimateReadingMinutes, type PMNode } from "@/lib/instructions/content";
import type { Prisma } from "@/generated/prisma/client";

// Журнал ознакомлений (docs/spec/07-instructions.md) — фильтры по инструкции
// и периоду. Изображение подписи никогда не возвращается здесь — спека явно:
// "не показывается в таблице, только в PDF" (см. отдельный /records/[id]/pdf).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const instructionId = searchParams.get("instructionId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Prisma.AcknowledgmentRecordWhereInput = {
    instruction: { tenantId: owner.tenantId },
  };
  if (instructionId) where.instructionId = instructionId;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
  }

  const records = await prisma.acknowledgmentRecord.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      instruction: { select: { title: true, currentVersionNumber: true } },
      version: { select: { versionNumber: true, content: true } },
    },
  });

  return NextResponse.json({
    records: records.map((r) => {
      // "Аномально короткое время чтения" (docs/spec/07-instructions.md,
      // "Макеты и вёрстка") — порог 25% от оценки для ТОЙ версии, которую
      // человек реально читал, не от текущей (могла с тех пор измениться).
      const estimatedSeconds = estimateReadingMinutes(r.version.content as unknown as PMNode) * 60;
      const isSuspiciouslyFast = r.readingSeconds < estimatedSeconds * 0.25;

      return {
        id: r.id,
        instructionId: r.instructionId,
        instructionTitle: r.instruction.title,
        lastName: r.lastName,
        firstName: r.firstName,
        phone: r.phone,
        birthDate: r.birthDate,
        readingSeconds: r.readingSeconds,
        ip: r.ip,
        deviceLabel: r.deviceLabel,
        browserLabel: r.browserLabel,
        versionNumber: r.version.versionNumber,
        isStale: r.version.versionNumber < r.instruction.currentVersionNumber,
        isSuspiciouslyFast,
        createdAt: r.createdAt,
      };
    }),
  });
}
