import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Flat tenant-wide zone list (with point name) — used to build the operator
// zone-access picker, where zones need to be grouped by point regardless of
// which point's detail screen the owner is currently on.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const zones = await prisma.zone.findMany({
    where: { point: { tenantId: owner.tenantId } },
    include: { point: { select: { name: true } } },
    orderBy: [{ point: { createdAt: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      // Иконка зоны — для выпадающих списков выбора кассы (реестр расходов,
      // запрос владельца 2026-08-16): в списке "из какой кассы" зоны узнаются
      // по значку так же, как на плитках.
      iconKey: zone.iconKey,
      pointId: zone.pointId,
      pointName: zone.point.name,
    })),
  });
}
