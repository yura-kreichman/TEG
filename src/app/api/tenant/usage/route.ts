import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    include: { package: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Тенант не найден" }, { status: 404 });
  }

  const [pointsUsed, operatorsUsed, zonesUsed] = await Promise.all([
    prisma.point.count({ where: { tenantId: owner.tenantId } }),
    prisma.operator.count({ where: { tenantId: owner.tenantId } }),
    prisma.zone.count({ where: { point: { tenantId: owner.tenantId } } }),
  ]);

  return NextResponse.json({
    packageName: tenant.package.name,
    subscriptionStatus: tenant.subscriptionStatus,
    points: { used: pointsUsed, max: tenant.package.maxPoints },
    operators: { used: operatorsUsed, max: tenant.package.maxOperators },
    zones: { used: zonesUsed, max: tenant.package.maxZones },
  });
}
