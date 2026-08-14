import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { listShiftDetails, listStandaloneMoneyOps } from "@/lib/work-time";
import { periodBoundsUtc } from "@/lib/business-day";

// Табель оператора — владелец видит всех (docs/spec/05-work-time.md,
// "ИНТЕРФЕЙС ВЛАДЕЛЬЦА"). "edited" — компактная отметка правки (иконка-карандаш),
// полная история — по entityId через тот же CorrectionLog, что у Счётчиков.
export async function GET(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/shifts">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  // Границы недели/месяца — в календаре тенанта, не в сырой UTC-полночи
  // сервера (см. periodBoundsUtc, фикс 2026-08-02).
  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  const period = fromParam && toParam ? periodBoundsUtc(fromParam, toParam, tenant?.timezone ?? "UTC", tenant?.businessDayBoundary ?? "00:00") : undefined;

  const shifts = await listShiftDetails(operator.id, period, { includeOpen: true });
  const editedIds = new Set(
    (
      await prisma.correctionLog.findMany({
        where: { entityType: "Shift", entityId: { in: shifts.map((s) => s.id) } },
        select: { entityId: true },
      })
    ).map((c) => c.entityId)
  );

  const rows = shifts.map((s) => ({ ...s, edited: editedIds.has(s.id) }));

  // Та же отметка правки для отдельных авансов/премий (2026-08-14): у смен
  // корона была с самого начала, у этих строк — нет, хотя правятся они так же
  // и тем же владельцем. Тип сущности другой ("MoneyOperation"), журнал тот же.
  const standaloneMoneyOps = await listStandaloneMoneyOps(operator.id, period);
  const editedOpIds = new Set(
    (
      await prisma.correctionLog.findMany({
        where: { entityType: "MoneyOperation", entityId: { in: standaloneMoneyOps.map((op) => op.id) } },
        select: { entityId: true },
      })
    ).map((c) => c.entityId)
  );

  return NextResponse.json({
    shifts: rows,
    standaloneMoneyOps: standaloneMoneyOps.map((op) => ({ ...op, edited: editedOpIds.has(op.id) })),
  });
}
