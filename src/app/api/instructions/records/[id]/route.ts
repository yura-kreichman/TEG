import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

async function loadRecord(id: string, tenantId: string) {
  const record = await prisma.acknowledgmentRecord.findUnique({
    where: { id },
    include: { instruction: true },
  });
  if (!record || record.instruction.tenantId !== tenantId) return null;
  return record;
}

// Удаление (docs/spec/07-instructions.md, "Журнал ознакомлений") — настоящее
// удаление строки (PDF/подпись атомарно уходят вместе с ней, см. Шаг 2:
// BLOB, не файл), но след остаётся в уже существующем CorrectionLog: кто,
// когда, чья запись — без подписи/телефона/IP в самом следе.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/instructions/records/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "instructionsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const record = await loadRecord(id, owner.tenantId);
  if (!record) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.correctionLog.create({
      data: {
        entityType: "AcknowledgmentRecord",
        entityId: record.id,
        correctedByUserId: owner.user.id,
        beforeJson: { lastName: record.lastName, firstName: record.firstName, instructionTitle: record.instruction.title },
        afterJson: { deleted: true },
        comment: null,
      },
    }),
    prisma.acknowledgmentRecord.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
