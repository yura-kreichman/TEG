import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";
import { localDateParts } from "@/lib/business-day";

// Перенос баланса — ручная запись владельца (стартовый баланс/корректировка),
// docs/spec/05-work-time.md, "БАЛАНС". НЕ операция денежного журнала — это не
// движение физической наличности, а корректировка того, сколько компания
// должна оператору. Может быть отрицательным.
export async function GET(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/carryover">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const [entries, tenant] = await Promise.all([
    prisma.operatorBalanceCarryover.findMany({
      where: { operatorId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } }),
  ]);
  const total = entries.reduce((sum, e) => sum + Number(e.amount), 0);
  const timezone = tenant?.timezone ?? "UTC";

  return NextResponse.json({
    total: Math.round(total * 100) / 100,
    entries: entries.map((e) => {
      // Календарный день записи В ПОЯСЕ ТЕНАНТА — по нему табель решает, в
      // каком месяце показать строку переноса. Считаем на сервере, а не
      // срезом от ISO-строки в браузере: сырой UTC-день у тенанта восточнее
      // UTC отличается от местного всё время после местной полуночи, и
      // запись, внесённая ночью 1-го числа, уезжала бы в предыдущий месяц
      // (тот же класс, что чинит periodBoundsUtc для смен).
      const { year, month, day } = localDateParts(e.createdAt, timezone);
      return {
        id: e.id,
        amount: Number(e.amount),
        comment: e.comment,
        createdAt: e.createdAt.toISOString(),
        localDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }),
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/carryover">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { amount, comment } = await request.json();
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber === 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  // Advisory-лок по operatorId (аудит 2026-07-26) — тот же класс бага, что и
  // у /advance и /bonus: форма не была защищена от двойного клика/тапа.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
    await tx.operatorBalanceCarryover.create({
      data: {
        tenantId: owner.tenantId,
        operatorId: operator.id,
        amount: amountNumber,
        comment: typeof comment === "string" && comment.trim() ? comment.trim() : null,
        createdByUserId: owner.user.id,
      },
    });
  });

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
