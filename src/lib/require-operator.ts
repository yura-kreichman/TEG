import { prisma } from "@/lib/prisma";
import { getActivatedDevice, getOperatorSessionId } from "@/lib/operator-auth";

/**
 * Resolves the current request to an activated PointDevice + logged-in, active
 * Operator belonging to that device's tenant. Returns null if any link in that
 * chain is missing — deactivating an operator or forgetting a device closes
 * this off immediately, since every check is read fresh from the DB.
 *
 * Иерархия деактивации начинается с точки (запрос пользователя 2026-07-16:
 * "деактивирована точка — она не может попасть к сотруднику ... иерархия
 * действует начиная с точки") — деактивированная точка блокирует ЛЮБОЕ
 * действие оператора на устройстве этой точки разом, тем же путём, что и
 * деактивация самого оператора. Каждый API-роут оператора вызывает
 * requireOperator() первым делом, так что этой одной проверки достаточно —
 * дальше по цепочке точка→зона→актив ничего специально каскадировать не
 * нужно (зоны отдельно уже фильтруются по zone.active в
 * /api/operator/submission-context).
 */
export async function requireOperator() {
  const device = await getActivatedDevice();
  if (!device) return null;
  if (!device.point.active) return null;

  const operatorId = await getOperatorSessionId();
  if (!operatorId) return null;

  const operator = await prisma.operator.findUnique({ where: { id: operatorId } });
  if (!operator || !operator.active || operator.tenantId !== device.point.tenantId) return null;

  return { operator, device, point: device.point };
}
