import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, findTenantPoint } from "@/lib/require-owner";
import { reviseGoodsStockBatch } from "@/lib/goods";
import { getPeriodRange, isPeriodGranularity } from "@/lib/reports";
import { isModuleEnabled } from "@/lib/tenant-modules";

interface RevisionLineOut {
  goodsName: string;
  calculatedQuantity: number;
  actualQuantity: number;
  difference: number;
}

interface RevisionBatchOut {
  id: string;
  pointName: string;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByAvatarUrl: string | null;
  performedByIconKey: string | null;
  occurredAt: Date;
  groups: { categoryName: string; lines: RevisionLineOut[] }[];
}

// Ревизия остатков по категории (docs/spec/09-goods.md, "Остатки") + история
// с расхождениями. Владелец может проводить всегда. История — за период
// (День/Неделя/Месяц/Год/Период, запрос пользователя 2026-07-19: "иначе
// список будет бесконечный" — тот же приём, что у /api/goods/sales), и
// группируется по batchId: несколько категорий, сохранённых одним "Сохранить",
// схлопываются в одну плашку вместо одной на категорию.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");

  const today = new Date();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const granularityParam = searchParams.get("granularity");
  let start: Date;
  let end: Date;
  if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    start = new Date(`${fromParam}T00:00:00.000Z`);
    end = new Date(new Date(`${toParam}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  } else {
    const granularity = isPeriodGranularity(granularityParam) ? granularityParam : "month";
    const anchorParam = searchParams.get("anchor");
    const anchor = anchorParam && /^\d{4}-\d{2}-\d{2}$/.test(anchorParam) ? new Date(`${anchorParam}T00:00:00.000Z`) : today;
    ({ start, end } = getPeriodRange(granularity, anchor, today));
  }

  const revisions = await prisma.goodsRevision.findMany({
    where: { tenantId: owner.tenantId, ...(pointId ? { pointId } : {}), occurredAt: { gte: start, lt: end } },
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: {
      point: { select: { name: true } },
      category: { select: { name: true } },
      performedByOperator: { select: { name: true, avatarUrl: true, iconKey: true } },
      performedByUser: { select: { id: true } },
      lines: { include: { goods: { select: { name: true } } } },
    },
  });

  const batches = new Map<string, RevisionBatchOut>();
  for (const r of revisions) {
    const key = r.batchId ?? r.id;
    const lines = r.lines.map((l) => ({
      goodsName: l.goods.name,
      calculatedQuantity: l.calculatedQuantity,
      actualQuantity: l.actualQuantity,
      difference: l.actualQuantity - l.calculatedQuantity,
    }));
    const existing = batches.get(key);
    if (existing) {
      existing.groups.push({ categoryName: r.category.name, lines });
      continue;
    }
    batches.set(key, {
      id: key,
      pointName: r.point.name,
      performedBy: r.performedByOperator?.name ?? null,
      performedByOwner: !!r.performedByUser,
      performedByAvatarUrl: r.performedByOperator?.avatarUrl ?? null,
      performedByIconKey: r.performedByOperator?.iconKey ?? null,
      occurredAt: r.occurredAt,
      groups: [{ categoryName: r.category.name, lines }],
    });
  }

  return NextResponse.json({
    period: { start: start.toISOString(), end: end.toISOString() },
    revisions: Array.from(batches.values()),
  });
}

function parseRevisionLines(lines: unknown): { goodsId: string; actualQuantity: number }[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((l: { goodsId?: unknown; actualQuantity?: unknown }) => ({
      goodsId: typeof l.goodsId === "string" ? l.goodsId : "",
      actualQuantity: Number(l.actualQuantity),
    }))
    .filter((l) => l.goodsId && Number.isInteger(l.actualQuantity) && l.actualQuantity >= 0);
}

// Ревизия сразу по нескольким категориям одним коммитом (запрос
// пользователя 2026-07-19: обходишь категории, меняешь остатки, жмёшь
// "Сохранить" один раз в конце) — тело теперь {pointId, groups:
// [{categoryId, lines}]}, не одна категория за запрос.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const pointId: string = typeof body.pointId === "string" ? body.pointId : "";
  const rawGroups = Array.isArray(body.groups) ? body.groups : [];

  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }

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
      tenantId: owner.tenantId,
      pointId,
      groups,
      actor: { userId: owner.user.id },
    });
    return NextResponse.json({ ids: revisions.map((r) => r.id) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "CATEGORY_NOT_FOUND" || err.message === "GOODS_NOT_FOUND")) {
      return NextResponse.json({ error: "Категория или товар не найдены" }, { status: 400 });
    }
    throw err;
  }
}
