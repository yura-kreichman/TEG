import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { localDateParts, zonedWallTimeToUtc } from "@/lib/business-day";

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
  // суток, а не new Date(). Часовой пояс ТЕНАНТА, не сырой UTC сервера (аудит
  // 2026-07-25, финальный проход, реальный найденный баг): для тенанта
  // восточнее UTC (Молдова/Румыния и т.п.) местная полночь выбранной даты —
  // это ещё вчерашний день по UTC; смена, начавшаяся в первые часы местных
  // суток нового effectiveFrom, получала бы старую ставку. Те же
  // zonedWallTimeToUtc/localDateParts, что уже чинят этот класс бага в
  // lib/business-day.ts/lib/reports.ts.
  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  const timezone = tenant?.timezone ?? "UTC";
  const today = new Date();
  const dateParts =
    typeof effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
      ? { year: Number(effectiveFrom.slice(0, 4)), month: Number(effectiveFrom.slice(5, 7)), day: Number(effectiveFrom.slice(8, 10)) }
      : localDateParts(today, timezone);
  const effectiveFromDate = zonedWallTimeToUtc(dateParts.year, dateParts.month, dateParts.day, 0, 0, timezone);

  const created = await prisma.operatorRate.create({
    data: { tenantId: owner.tenantId, operatorId: id, rate: rateNumber, effectiveFrom: effectiveFromDate },
  });

  return NextResponse.json({ id: created.id, rate: Number(created.rate), effectiveFrom: created.effectiveFrom.toISOString() });
}
