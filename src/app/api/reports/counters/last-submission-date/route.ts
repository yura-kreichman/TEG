import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { localDateParts } from "@/lib/business-day";

// Дата последней сдачи итогов по точке — для дефолта на экране /money/readings
// (запрос пользователя 2026-07-15: по умолчанию должен открываться последний
// день сдач итогов, а не сегодняшний пустой день/месяц). Тот же принцип, что
// уже есть на /money (last-submission-date), но по точке, а не по тенанту в
// целом — на этом экране точка выбирается явно, и у разных точек последняя
// сдача может быть в разные дни.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");
  if (!pointId) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId }, include: { tenant: { select: { timezone: true } } } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const submission = await prisma.resultsSubmission.findFirst({
    where: { pointId },
    orderBy: { submittedAt: "desc" },
    select: { submittedAt: true },
  });

  // Местная календарная дата тенанта, не сырой UTC (аудит 2026-07-24) — эта
  // дата напрямую становится значением ?date= у /api/reports/counters/day,
  // поэтому смещение на день здесь означало бы, что "Итоги дня" при обычном
  // открытии экрана (без выбора даты вручную) сразу показывали бы не тот
  // день, что реально сдавался последним.
  if (!submission) return NextResponse.json({ date: null });
  const { year, month, day } = localDateParts(submission.submittedAt, point.tenant.timezone ?? "UTC");
  return NextResponse.json({ date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
}
