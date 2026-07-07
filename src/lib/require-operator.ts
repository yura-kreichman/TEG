import { prisma } from "@/lib/prisma";
import { getActivatedDevice, getOperatorSessionId } from "@/lib/operator-auth";

/**
 * Resolves the current request to an activated PointDevice + logged-in, active
 * Operator belonging to that device's tenant. Returns null if any link in that
 * chain is missing — deactivating an operator or forgetting a device closes
 * this off immediately, since every check is read fresh from the DB.
 */
export async function requireOperator() {
  const device = await getActivatedDevice();
  if (!device) return null;

  const operatorId = await getOperatorSessionId();
  if (!operatorId) return null;

  const operator = await prisma.operator.findUnique({ where: { id: operatorId } });
  if (!operator || !operator.active || operator.tenantId !== device.point.tenantId) return null;

  return { operator, device, point: device.point };
}
