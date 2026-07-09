import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import {
  DAILY_CASH_SUMMARY_DEFAULTS,
  isDailyCashSendMode,
  isTimeString,
  type DailyCashSummarySettingsData,
} from "@/lib/summary-settings";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const row = await prisma.dailyCashSummarySettings.findUnique({ where: { tenantId: owner.tenantId } });
  return NextResponse.json(row ?? DAILY_CASH_SUMMARY_DEFAULTS);
}

const BOOLEAN_FIELDS = [
  "enabled",
  "skipIfNoSubmissions",
  "updateOnLateSubmission",
  "showCash",
  "showExpenses",
  "showZoneBreakdown",
  "showCashOnHand",
] as const satisfies readonly (keyof DailyCashSummarySettingsData)[];

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: Partial<DailyCashSummarySettingsData> = {};

  for (const key of BOOLEAN_FIELDS) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }
  if (body.sendMode !== undefined) {
    if (!isDailyCashSendMode(body.sendMode)) {
      return NextResponse.json({ error: "Некорректный режим отправки" }, { status: 400 });
    }
    data.sendMode = body.sendMode;
  }
  if (body.fixedTime !== undefined) {
    if (!isTimeString(body.fixedTime)) {
      return NextResponse.json({ error: "Некорректное время (ЧЧ:ММ)" }, { status: 400 });
    }
    data.fixedTime = body.fixedTime;
  }
  if (body.businessDayBoundary !== undefined) {
    if (!isTimeString(body.businessDayBoundary)) {
      return NextResponse.json({ error: "Некорректная граница бизнес-дня (ЧЧ:ММ)" }, { status: 400 });
    }
    data.businessDayBoundary = body.businessDayBoundary;
  }

  const row = await prisma.dailyCashSummarySettings.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...DAILY_CASH_SUMMARY_DEFAULTS, ...data },
    update: data,
  });

  return NextResponse.json(row);
}
