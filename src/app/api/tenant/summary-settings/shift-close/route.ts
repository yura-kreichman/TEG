import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS, type ShiftCloseSummarySettingsData } from "@/lib/summary-settings";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const row = await prisma.shiftCloseSummarySettings.findUnique({ where: { tenantId: owner.tenantId } });
  return NextResponse.json(row ?? SHIFT_CLOSE_SUMMARY_DEFAULTS);
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: Partial<ShiftCloseSummarySettingsData> = {};
  for (const key of Object.keys(SHIFT_CLOSE_SUMMARY_DEFAULTS) as (keyof ShiftCloseSummarySettingsData)[]) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }

  const row = await prisma.shiftCloseSummarySettings.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...SHIFT_CLOSE_SUMMARY_DEFAULTS, ...data },
    update: data,
  });

  return NextResponse.json(row);
}
