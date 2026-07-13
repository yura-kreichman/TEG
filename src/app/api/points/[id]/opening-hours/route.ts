import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface DayInput {
  weekday: number;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

function isValidDay(d: unknown): d is DayInput {
  if (!d || typeof d !== "object") return false;
  const { weekday, isOpen, opensAt, closesAt } = d as Record<string, unknown>;
  if (typeof weekday !== "number" || weekday < 0 || weekday > 6) return false;
  if (typeof isOpen !== "boolean") return false;
  if (isOpen) {
    if (typeof opensAt !== "string" || !TIME_RE.test(opensAt)) return false;
    if (typeof closesAt !== "string" || !TIME_RE.test(closesAt)) return false;
    // Оверночные интервалы не поддержаны в MVP (docs/spec/08-landing.md,
    // PointOpeningHours) — closesAt должен быть позже opensAt в тот же день.
    if (closesAt <= opensAt) return false;
  } else {
    if (opensAt !== null || closesAt !== null) return false;
  }
  return true;
}

export async function GET(_request: Request, ctx: RouteContext<"/api/points/[id]/opening-hours">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const hours = await prisma.pointOpeningHours.findMany({ where: { pointId: id }, orderBy: { weekday: "asc" } });
  return NextResponse.json({ hours });
}

// Всегда сохраняет все 7 дней разом (docs/spec/08-landing.md, PointOpeningHours:
// "форма настроек Точки всегда сохраняет все 7 сразу, частичного набора не
// бывает") — иначе "недостаточно данных" для "Сегодня работают" пришлось бы
// определять эвристикой вместо простого count === 7.
export async function PUT(request: Request, ctx: RouteContext<"/api/points/[id]/opening-hours">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { days } = await request.json();
  if (!Array.isArray(days) || days.length !== 7 || !days.every(isValidDay)) {
    return NextResponse.json({ error: "Нужны все 7 дней недели с корректными полями" }, { status: 400 });
  }
  const weekdays = new Set(days.map((d: DayInput) => d.weekday));
  if (weekdays.size !== 7) {
    return NextResponse.json({ error: "Каждый день недели должен встречаться ровно один раз" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.pointOpeningHours.deleteMany({ where: { pointId: id } }),
    prisma.pointOpeningHours.createMany({
      data: (days as DayInput[]).map((d) => ({
        pointId: id,
        weekday: d.weekday,
        isOpen: d.isOpen,
        opensAt: d.opensAt,
        closesAt: d.closesAt,
      })),
    }),
  ]);
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
