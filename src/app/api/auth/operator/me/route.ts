import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActivatedDevice, getOperatorSessionId } from "@/lib/operator-auth";

export async function GET() {
  const device = await getActivatedDevice();
  if (!device) {
    return NextResponse.json({ device: null, operator: null });
  }
  const point = device.point;

  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId } });
  const deviceInfo = {
    pointId: point.id,
    pointName: point.name,
    tenantName: tenant?.name ?? null,
    roaming: device.roaming,
  };

  const operatorId = await getOperatorSessionId();
  if (!operatorId) {
    return NextResponse.json({ device: deviceInfo, operator: null });
  }

  const operator = await prisma.operator.findUnique({ where: { id: operatorId } });
  if (!operator || !operator.active || operator.tenantId !== point.tenantId) {
    return NextResponse.json({ device: deviceInfo, operator: null });
  }

  return NextResponse.json({
    device: deviceInfo,
    operator: { id: operator.id, name: operator.name, avatarUrl: operator.avatarUrl },
  });
}
