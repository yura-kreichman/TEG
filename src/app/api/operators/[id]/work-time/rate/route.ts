import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";

// История ставок (docs/spec/05-work-time.md, "СТАВКА") — GET отдаёт всю
// историю (новые сверху), PATCH добавляет новую запись. Прошлые смены не
// пересчитываются: изменение действует только с effectiveFrom вперёд.
export async function GET(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/rate">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const history = await prisma.operatorRate.findMany({
    where: { operatorId: id },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    history: history.map((r) => ({ id: r.id, rate: Number(r.rate), effectiveFrom: r.effectiveFrom.toISOString() })),
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/rate">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { rate, effectiveFrom } = await request.json();
  const rateNumber = Number(rate);
  if (!Number.isFinite(rateNumber) || rateNumber < 0) {
    return NextResponse.json({ error: "Некорректная ставка" }, { status: 400 });
  }
  // "effective_from" — дата, не точный момент (docs/spec/05-work-time.md,
  // "СТАВКА"): без этого смена, начавшаяся тем же днём РАНЬШЕ точного времени
  // сохранения ставки, получила бы rate=0. По умолчанию — начало сегодняшних
  // суток, а не new Date().
  const today = new Date();
  const effectiveFromDate =
    typeof effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
      ? new Date(`${effectiveFrom}T00:00:00.000Z`)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const created = await prisma.operatorRate.create({
    data: { tenantId: owner.tenantId, operatorId: id, rate: rateNumber, effectiveFrom: effectiveFromDate },
  });

  return NextResponse.json({ id: created.id, rate: Number(created.rate), effectiveFrom: created.effectiveFrom.toISOString() });
}
