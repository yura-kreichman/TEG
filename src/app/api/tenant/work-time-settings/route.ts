import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TOLERANCE_FIELDS = ["earlyToleranceMinutes", "lateToleranceMinutes"] as const;
type ToleranceField = (typeof TOLERANCE_FIELDS)[number];

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: {
      defaultShiftStartTime: true,
      businessDayBoundary: true,
      earlyToleranceMinutes: true,
      lateToleranceMinutes: true,
    },
  });

  return NextResponse.json({
    defaultShiftStartTime: tenant?.defaultShiftStartTime ?? "10:00",
    // Единственное место редактирования (docs/spec/05-work-time.md, фидбек
    // 2026-07-11) — раньше дублировалось на "Касса за день", убрано оттуда.
    businessDayBoundary: tenant?.businessDayBoundary ?? "06:00",
    earlyToleranceMinutes: tenant?.earlyToleranceMinutes ?? 120,
    lateToleranceMinutes: tenant?.lateToleranceMinutes ?? 120,
  });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: {
    defaultShiftStartTime?: string;
    businessDayBoundary?: string;
  } & Partial<Record<ToleranceField, number>> = {};

  if (body.defaultShiftStartTime !== undefined) {
    if (typeof body.defaultShiftStartTime !== "string" || !TIME_RE.test(body.defaultShiftStartTime)) {
      return NextResponse.json({ error: "Некорректное время (ожидается ЧЧ:ММ)" }, { status: 400 });
    }
    data.defaultShiftStartTime = body.defaultShiftStartTime;
  }
  if (body.businessDayBoundary !== undefined) {
    if (typeof body.businessDayBoundary !== "string" || !TIME_RE.test(body.businessDayBoundary)) {
      return NextResponse.json({ error: "Некорректная граница бизнес-дня (ожидается ЧЧ:ММ)" }, { status: 400 });
    }
    data.businessDayBoundary = body.businessDayBoundary;
  }
  for (const field of TOLERANCE_FIELDS) {
    if (body[field] === undefined) continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0 || value > 24 * 60) {
      return NextResponse.json({ error: "Некорректный допуск времени (минуты)" }, { status: 400 });
    }
    data[field] = Math.round(value);
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  return NextResponse.json({ ok: true });
}
