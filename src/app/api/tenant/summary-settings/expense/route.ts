import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { EXPENSE_SUMMARY_DEFAULTS, type ExpenseSummarySettingsData } from "@/lib/summary-settings";

// Тумблер "Новый расход" для Telegram/email (запрос владельца 2026-08-15) —
// один в один instruction-ack/route.ts рядом: одно поле enabled, состав
// сообщения не настраивается.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const row = await prisma.expenseSummarySettings.findUnique({ where: { tenantId: owner.tenantId } });
  return NextResponse.json(row ?? EXPENSE_SUMMARY_DEFAULTS);
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: Partial<ExpenseSummarySettingsData> = {};
  for (const key of Object.keys(EXPENSE_SUMMARY_DEFAULTS) as (keyof ExpenseSummarySettingsData)[]) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }

  const row = await prisma.expenseSummarySettings.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...EXPENSE_SUMMARY_DEFAULTS, ...data },
    update: data,
  });

  return NextResponse.json(row);
}
