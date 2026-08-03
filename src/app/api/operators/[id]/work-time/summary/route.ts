import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { getRateForDate, calcOperatorBalance } from "@/lib/work-time";
import { periodBoundsUtc } from "@/lib/business-day";

// Баланс конкретного оператора — владелец видит всех (docs/spec/05-work-time.md).
export async function GET(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/summary">) {
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
  // Границы недели/месяца — в календаре тенанта (см. periodBoundsUtc).
  // Здесь это важно вдвойне: "заработано за период" на карточке сотрудника
  // считается по этим же границам, и смена, начатая ночью, иначе уезжала в
  // соседний месяц вместе со своей суммой.
  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { timezone: true },
  });
  const period = fromParam && toParam ? periodBoundsUtc(fromParam, toParam, tenant?.timezone ?? "UTC") : undefined;

  const balance = await calcOperatorBalance(operator.id, period);
  const currentRate = await getRateForDate(operator.id, new Date());

  return NextResponse.json({ ...balance, currentRate });
}
