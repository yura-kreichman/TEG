import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { generateAcknowledgmentPdf } from "@/lib/instructions/pdf";
import { isModuleEnabled } from "@/lib/tenant-modules";
import type { PMNode } from "@/lib/instructions/content";

// Генерация на сервере по требованию (docs/spec/07-instructions.md, "PDF") —
// не хранится файлом, только владелец (requireOwner). Документ строится из
// InstructionVersion.content — той версии, которая была подписана, а не
// текущего состояния инструкции.
export async function GET(_request: Request, ctx: RouteContext<"/api/instructions/records/[id]/pdf">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "instructionsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const record = await prisma.acknowledgmentRecord.findUnique({
    where: { id },
    include: { instruction: true, version: true },
  });
  if (!record || record.instruction.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const pdfBuffer = await generateAcknowledgmentPdf({
    lastName: record.lastName,
    firstName: record.firstName,
    birthDate: record.birthDate,
    createdAt: record.createdAt,
    ip: record.ip,
    signaturePng: Buffer.from(record.signaturePng),
    instructionTitle: record.version.title,
    versionContent: record.version.content as unknown as PMNode,
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="instruction-ack-${id}.pdf"`,
    },
  });
}
