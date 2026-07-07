import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Lets an operator on a "roaming" device (docs/spec/00-architecture.md — device
// bound to a point, but some devices travel with a person across points) pick
// a different point of the same tenant in-app, without the Owner having to
// issue a fresh install link every time they move. Rebinding a device's
// pointId doesn't touch history: ResultsSubmission stores its own pointId
// snapshot at submission time, so nothing is retroactively affected.
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  if (!ctx.device.roaming) {
    return NextResponse.json(
      { error: "Это устройство привязано к точке владельцем — смена точки недоступна" },
      { status: 403 }
    );
  }

  const { pointId } = await request.json();
  if (typeof pointId !== "string") {
    return NextResponse.json({ error: "pointId обязателен" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== ctx.point.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  await prisma.pointDevice.update({ where: { id: ctx.device.id }, data: { pointId } });

  return NextResponse.json({ ok: true, pointName: point.name });
}
