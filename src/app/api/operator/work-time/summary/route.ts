import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/modules";
import { getRateForDate, calcOperatorBalance } from "@/lib/work-time";

// Баланс "К выдаче" + заработано/ставка/премии/авансы за период — только для
// себя (docs/spec/05-work-time.md, "РОЛИ И ВИДИМОСТЬ").
export async function GET(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  if (!(await isModuleEnabled(ctx.point.tenantId, "work_time"))) {
    return NextResponse.json({ error: "Модуль не подключён" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  // "to" приходит как дата включительно (как в /api/reports/money) — переводим
  // в exclusive-границу для сравнения.
  const period =
    fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)
      ? {
          from: new Date(`${fromParam}T00:00:00.000Z`),
          to: new Date(new Date(`${toParam}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
        }
      : undefined;

  const balance = await calcOperatorBalance(ctx.operator.id, period);
  const currentRate = await getRateForDate(ctx.operator.id, new Date());
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.point.tenantId },
    select: {
      defaultShiftStartTime: true,
      earlyToleranceMinutes: true,
      lateToleranceMinutes: true,
    },
  });

  return NextResponse.json({
    ...balance,
    currentRate,
    defaultShiftStartTime: tenant?.defaultShiftStartTime ?? "10:00",
    earlyToleranceMinutes: tenant?.earlyToleranceMinutes ?? 120,
    lateToleranceMinutes: tenant?.lateToleranceMinutes ?? 120,
  });
}
