import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { COLLECTION_SUMMARY_DEFAULTS, type CollectionSummarySettingsData } from "@/lib/summary-settings";

// Тумблер "Инкассация" для Telegram/email (запрос владельца 2026-08-16) —
// один в один соседние expense/instruction-ack: одно поле enabled.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const row = await prisma.collectionSummarySettings.findUnique({ where: { tenantId: owner.tenantId } });
  return NextResponse.json(row ?? COLLECTION_SUMMARY_DEFAULTS);
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: Partial<CollectionSummarySettingsData> = {};
  for (const key of Object.keys(COLLECTION_SUMMARY_DEFAULTS) as (keyof CollectionSummarySettingsData)[]) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }

  const row = await prisma.collectionSummarySettings.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...COLLECTION_SUMMARY_DEFAULTS, ...data },
    update: data,
  });

  return NextResponse.json(row);
}
