import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Point list for the "Сменить точку" picker on roaming devices. Не все точки
// тенанта подряд — фидбек пользователя 2026-07-12 (тот же баг, что чинили в
// /api/operators/[id] для формы Аванс/Премия, но здесь на стороне оператора):
// если у оператора allZonesAccess=false, точка без единой разрешённой зоны
// для него — тупик (переключится, а работать не с чем), поэтому список
// сужается до точек, где у оператора есть хотя бы одна разрешённая зона.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  // Деактивированные (сезонно закрытые) точки не предлагаются роуминг-
  // устройству для переключения — решение пользователя 2026-07-13.
  const points = await prisma.point.findMany({
    where: { tenantId: ctx.point.tenantId, active: true },
    select: { id: true, name: true, iconKey: true },
    orderBy: { createdAt: "asc" },
  });

  if (ctx.operator.allZonesAccess) {
    return NextResponse.json({ points });
  }

  const withZones = await prisma.operator.findUnique({
    where: { id: ctx.operator.id },
    select: { allowedZones: { select: { pointId: true } } },
  });
  const allowedPointIds = new Set((withZones?.allowedZones ?? []).map((z) => z.pointId));

  return NextResponse.json({ points: points.filter((p) => allowedPointIds.has(p.id)) });
}
