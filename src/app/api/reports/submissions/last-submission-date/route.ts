import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { businessDayOf } from "@/lib/business-day";

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

  const point = await prisma.point.findUnique({ where: { id: pointId }, include: { tenant: { select: { timezone: true, businessDayBoundary: true } } } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  // Сверки кассы Товаров — тоже кандидат на "последний день с данными"
  // (реальный баг, найден пользователем 2026-07-31: сдал кассу Товаров, а
  // экран при открытии всё равно показывал старую дату последней Сдачи
  // итогов зоны, потому что этот эндпоинт вообще не знал про Товары —
  // Товары не привязаны к режиму учёта "Счётчики"/к Сдаче итогов зоны).
  const [submission, goodsReconciliation] = await Promise.all([
    prisma.resultsSubmission.findFirst({
      where: { pointId },
      orderBy: { submittedAt: "desc" },
      select: { submittedAt: true },
    }),
    prisma.goodsReconciliation.findFirst({
      where: { pointId },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
  ]);
  const latest = [submission?.submittedAt, goodsReconciliation?.occurredAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  // Местная календарная дата тенанта, не сырой UTC (аудит 2026-07-24) — эта
  // дата напрямую становится значением ?date= у /api/reports/submissions/day,
  // поэтому смещение на день здесь означало бы, что "Итоги дня" при обычном
  // открытии экрана (без выбора даты вручную) сразу показывали бы не тот
  // день, что реально сдавался последним.
  if (!latest) return NextResponse.json({ date: null });
  const { year, month, day } = businessDayOf(
    latest,
    point.tenant.timezone ?? "UTC",
    point.tenant.businessDayBoundary ?? "00:00"
  );
  return NextResponse.json({ date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
}
