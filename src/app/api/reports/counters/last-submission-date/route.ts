import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

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

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const submission = await prisma.resultsSubmission.findFirst({
    where: { pointId },
    orderBy: { submittedAt: "desc" },
    select: { submittedAt: true },
  });

  return NextResponse.json({ date: submission ? submission.submittedAt.toISOString().slice(0, 10) : null });
}
