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

  // businessDayBoundary — поле Tenant, не этой таблицы (docs/spec/05-work-time.md,
  // перенесено 2026-07-11: значение общетенантное, его же читает Рабочее время).
  const [row, tenant] = await Promise.all([
    prisma.dailyCashSummarySettings.findUnique({ where: { tenantId: owner.tenantId } }),
    prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { businessDayBoundary: true } }),
  ]);
  const businessDayBoundary = tenant?.businessDayBoundary ?? DAILY_CASH_SUMMARY_DEFAULTS.businessDayBoundary;

  return NextResponse.json({ ...(row ?? DAILY_CASH_SUMMARY_DEFAULTS), businessDayBoundary });
}

const BOOLEAN_FIELDS = [
  "enabled",
  "skipIfNoSubmissions",
  "updateOnLateSubmission",
  "showCash",
  "showExpenses",
  "showZoneBreakdown",
  "showCashOnHand",
  "compact",
] as const satisfies readonly (keyof DailyCashSummarySettingsData)[];

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: Partial<Omit<DailyCashSummarySettingsData, "businessDayBoundary">> = {};

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

  // businessDayBoundary больше НЕ редактируется здесь (фидбек пользователя
  // 2026-07-11 — дублировалось с Настройками Рабочего времени, единственное
  // место редактирования теперь там); GET по-прежнему отдаёт текущее значение
  // справочно.
  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { businessDayBoundary: true },
  });
  const businessDayBoundary = tenant?.businessDayBoundary ?? DAILY_CASH_SUMMARY_DEFAULTS.businessDayBoundary;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- отбрасываем поле, которого больше нет в этой таблице
  const { businessDayBoundary: discardedBoundaryDefault, ...settingsDefaults } = DAILY_CASH_SUMMARY_DEFAULTS;
  const row = await prisma.dailyCashSummarySettings.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...settingsDefaults, ...data },
    update: data,
  });

  return NextResponse.json({ ...row, businessDayBoundary });
}
