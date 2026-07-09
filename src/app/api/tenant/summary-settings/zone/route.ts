import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { ZONE_SUMMARY_DEFAULTS, type ZoneSummarySettingsData } from "@/lib/summary-settings";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const row = await prisma.zoneSummarySettings.findUnique({ where: { tenantId: owner.tenantId } });
  return NextResponse.json(row ?? ZONE_SUMMARY_DEFAULTS);
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: Partial<ZoneSummarySettingsData> = {};
  for (const key of Object.keys(ZONE_SUMMARY_DEFAULTS) as (keyof ZoneSummarySettingsData)[]) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }

  const row = await prisma.zoneSummarySettings.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...ZONE_SUMMARY_DEFAULTS, ...data },
    update: data,
  });

  return NextResponse.json(row);
}
