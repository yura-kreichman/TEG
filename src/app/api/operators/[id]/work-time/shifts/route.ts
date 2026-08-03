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
    select: { timezone: true },
  });
  const period = fromParam && toParam ? periodBoundsUtc(fromParam, toParam, tenant?.timezone ?? "UTC") : undefined;

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
  const standaloneMoneyOps = await listStandaloneMoneyOps(operator.id, period);
  return NextResponse.json({ shifts: rows, standaloneMoneyOps });
}
