import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";

/**
 * Журнал расходов, зафиксированных Сотрудником в моменте (запрос
 * пользователя 2026-07-25: "чтобы не надо было запоминать до конца смены") —
 * тот же принцип, что у /api/operator/zone-return-events, но доступен для
 * ЛЮБОЙ зоны точки, не только режима "Счётчики" (расход не завязан на режим
 * учёта — экран "Расходы" не в баре "Счётчики", виден всем операторам).
 * "Текущий период" зоны — то же самое previousSubmissionBoundary: всё, что
 * накопилось ПОСЛЕ последней сдачи этой зоны, "обнуляется" следующей сдачей.
 */
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  // Настройки → Система → "Расходы" (запрос пользователя 2026-07-25) —
  // серверная проверка, не только скрытие кнопки/экрана в UI (тот же
  // принцип, что у goodsAllowBalancePayment/Operator.goodsAccess).
  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { expensesEnabled: true } });
  if (tenant?.expensesEnabled === false) {
    return NextResponse.json({ error: "Расходы отключены владельцем" }, { status: 403 });
  }

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id, active: true }
    : { pointId: point.id, active: true, operatorsWithAccess: { some: { id: operator.id } } };

  const [zones, categories] = await Promise.all([
    prisma.zone.findMany({
      where: zoneWhere,
      select: { id: true, name: true, iconKey: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expenseCategory.findMany({
      where: { tenantId: point.tenantId },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  if (zones.length === 0) {
    return NextResponse.json({ zones: [], categories, events: [] });
  }

  const boundaries = await Promise.all(zones.map((z) => previousSubmissionBoundary(z.id)));
  const boundaryByZone = new Map(zones.map((z, i) => [z.id, boundaries[i]]));

  const rawEvents = await prisma.zoneExpenseEvent.findMany({
    where: { zoneId: { in: zones.map((z) => z.id) } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { category: { select: { name: true } } },
  });
  // Только текущий (ещё не сданный) период каждой зоны — та же логика, что
  // у Возвратов/тестов.
  const events = rawEvents.filter((e) => {
    const boundary = boundaryByZone.get(e.zoneId);
    return !boundary || e.createdAt > boundary;
  });

  const zoneById = new Map(zones.map((z) => [z.id, z]));
  return NextResponse.json({
    zones,
    categories,
    events: events.map((e) => ({
      id: e.id,
      zoneId: e.zoneId,
      zoneName: zoneById.get(e.zoneId)?.name ?? "",
      amount: Number(e.amount),
      categoryName: e.category?.name ?? null,
      comment: e.comment,
      createdAt: e.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { expensesEnabled: true } });
  if (tenant?.expensesEnabled === false) {
    return NextResponse.json({ error: "Расходы отключены владельцем" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const zoneId = body?.zoneId;
  const amount = Number(body?.amount);
  const categoryId: string | null = typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;
  const comment: string | null = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;

  if (typeof zoneId !== "string" || !zoneId) {
    return NextResponse.json({ error: "Не указана зона" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zone = await prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId: point.id,
      active: true,
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    select: { id: true },
  });
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  if (categoryId) {
    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.tenantId !== point.tenantId) {
      return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
    }
  }

  const event = await prisma.zoneExpenseEvent.create({
    data: { zoneId: zone.id, pointId: point.id, operatorId: operator.id, amount, categoryId, comment },
  });
  return NextResponse.json({
    id: event.id,
    zoneId: event.zoneId,
    amount: Number(event.amount),
    createdAt: event.createdAt,
  });
}
