import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getRateForDate, calcOperatorBalance } from "@/lib/work-time";
import { periodBoundsUtc } from "@/lib/business-day";

// Баланс "К выдаче" + заработано/ставка/премии/авансы за период — только для
// себя (docs/spec/05-work-time.md, "РОЛИ И ВИДИМОСТЬ").
export async function GET(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.point.tenantId },
    select: {
      timezone: true,
      defaultShiftStartTime: true,
      earlyToleranceMinutes: true,
      lateToleranceMinutes: true,
    },
  });

  // "to" приходит как дата включительно (как в /api/reports/money). Границы —
  // в календаре тенанта, не в сырой UTC-полночи сервера (см. periodBoundsUtc).
  const period =
    fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)
      ? periodBoundsUtc(fromParam, toParam, tenant?.timezone ?? "UTC")
      : undefined;

  const balance = await calcOperatorBalance(ctx.operator.id, period);
  const currentRate = await getRateForDate(ctx.operator.id, new Date());

  return NextResponse.json({
    ...balance,
    currentRate,
    defaultShiftStartTime: tenant?.defaultShiftStartTime ?? "10:00",
    earlyToleranceMinutes: tenant?.earlyToleranceMinutes ?? 120,
    lateToleranceMinutes: tenant?.lateToleranceMinutes ?? 120,
  });
}
