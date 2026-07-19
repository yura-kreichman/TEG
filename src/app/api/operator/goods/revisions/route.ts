import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { reviseGoodsStockBatch } from "@/lib/goods";

function parseRevisionLines(lines: unknown): { goodsId: string; actualQuantity: number }[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((l: { goodsId?: unknown; actualQuantity?: unknown }) => ({
      goodsId: typeof l.goodsId === "string" ? l.goodsId : "",
      actualQuantity: Number(l.actualQuantity),
    }))
    .filter((l) => l.goodsId && Number.isInteger(l.actualQuantity) && l.actualQuantity >= 0);
}

// Ревизия остатков — оператор с тумблером goodsAccess И отдельным
// revisionAccess (запрос пользователя 2026-07-19: "Сотрудник не должен
// иметь право делать ревизию остатков" — переопределяет базовую точку для
// расчёта остатка, доверить можно не любому сотруднику, в отличие от
// обычной продажи/сдачи кассы). Сразу по нескольким категориям одним
// коммитом (запрос пользователя 2026-07-19, тот же приём, что у
// /api/goods/revisions) — тело {groups: [{categoryId, lines}]}.
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!ctx.operator.goodsAccess || !ctx.operator.revisionAccess) {
    return NextResponse.json({ error: "Нет доступа к ревизии остатков" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawGroups = Array.isArray(body.groups) ? body.groups : [];

  const groups = rawGroups
    .map((g: { categoryId?: unknown; lines?: unknown }) => ({
      categoryId: typeof g.categoryId === "string" ? g.categoryId : "",
      lines: parseRevisionLines(g.lines),
    }))
    .filter((g: { categoryId: string; lines: unknown[] }) => g.categoryId && g.lines.length > 0);
  if (groups.length === 0) {
    return NextResponse.json({ error: "Нет строк ревизии" }, { status: 400 });
  }

  try {
    const revisions = await reviseGoodsStockBatch({
      tenantId: ctx.operator.tenantId,
      pointId: ctx.point.id,
      groups,
      actor: { operatorId: ctx.operator.id },
    });
    return NextResponse.json({ ids: revisions.map((r) => r.id) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "CATEGORY_NOT_FOUND" || err.message === "GOODS_NOT_FOUND")) {
      return NextResponse.json({ error: "Категория или товар не найдены" }, { status: 400 });
    }
    throw err;
  }
}
