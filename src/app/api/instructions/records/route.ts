import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { estimateReadingMinutes, type PMNode } from "@/lib/instructions/content";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { periodBoundsUtc } from "@/lib/business-day";
import type { Prisma } from "@/generated/prisma/client";

// Журнал ознакомлений (docs/spec/07-instructions.md) — фильтры по инструкции
// и периоду. Изображение подписи никогда не возвращается здесь — спека явно:
// "не показывается в таблице, только в PDF" (см. отдельный /records/[id]/pdf).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "instructionsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
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
    // Границы дат — в календаре тенанта, не в сырой UTC-полночи сервера
    // (см. periodBoundsUtc, тот же фикс 2026-08-02, что и у Рабочего
    // времени): подписание, сделанное ночью, иначе попадало бы в
    // предыдущий день журнала. Каждая граница считается независимо —
    // здесь, в отличие от соседних экранов, "от" и "до" необязательны и
    // могут прийти по одной.
    const tenantForTz = await prisma.tenant.findUnique({
      where: { id: owner.tenantId },
      select: { timezone: true },
    });
    const timezone = tenantForTz?.timezone ?? "UTC";
    where.createdAt = {
      ...(from ? { gte: periodBoundsUtc(from, from, timezone).from } : {}),
      // lt следующей местной полуночи вместо lte 23:59:59.999 — так день
      // "до" остаётся включительным, но без щели в последнюю миллисекунду.
      ...(to ? { lt: periodBoundsUtc(to, to, timezone).to } : {}),
    };
  }

  const records = await prisma.acknowledgmentRecord.findMany({
    where,
    orderBy: { createdAt: "desc" },
    // take — тот же защитный потолок, что у соседних журналов (Продажи
    // Товаров take:300, Сверки take:100) — без него список ознакомлений
    // читался вообще без ограничения (аудит 2026-07-24: from/to — опциональные
    // фильтры, без них весь журнал тенанта за всё время в одном ответе).
    take: 500,
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
