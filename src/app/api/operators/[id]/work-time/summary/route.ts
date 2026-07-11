import { NextResponse } from "next/server";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { getRateForDate, calcOperatorBalance } from "@/lib/work-time";

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
  const period =
    fromParam && toParam
      ? {
          from: new Date(`${fromParam}T00:00:00.000Z`),
          to: new Date(new Date(`${toParam}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
        }
      : undefined;

  const balance = await calcOperatorBalance(operator.id, period);
  const currentRate = await getRateForDate(operator.id, new Date());

  return NextResponse.json({ ...balance, currentRate });
}
