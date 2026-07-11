import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { PUSH_NOTIFICATION_DEFAULTS, type PushNotificationSettingsData } from "@/lib/summary-settings";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const row = await prisma.pushNotificationSettings.findUnique({ where: { tenantId: owner.tenantId } });
  return NextResponse.json(row ?? PUSH_NOTIFICATION_DEFAULTS);
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: Partial<PushNotificationSettingsData> = {};
  for (const key of Object.keys(PUSH_NOTIFICATION_DEFAULTS) as (keyof PushNotificationSettingsData)[]) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }

  const row = await prisma.pushNotificationSettings.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...PUSH_NOTIFICATION_DEFAULTS, ...data },
    update: data,
  });

  return NextResponse.json(row);
}
