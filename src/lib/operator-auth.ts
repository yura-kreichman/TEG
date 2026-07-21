import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sessionCookieOptions, signToken, verifyToken } from "@/lib/session-crypto";

// Two distinct cookies for the operator (point-of-sale) flow, separate from the
// Owner/Super Admin cookies in src/lib/auth.ts:
//
// - POINT_DEVICE_COOKIE: set once when a "device of the point" is activated via
//   an install link/QR (see docs/spec/00-architecture.md). Long-lived. Identifies
//   *which point* this physical device belongs to — not a person.
// - OPERATOR_SESSION_COOKIE: set after an operator enters a correct PIN on an
//   already-activated device. Shorter-lived, meant to be re-entered across work
//   sessions/shift handovers ("пересменка"), and cleared explicitly when an
//   operator is done so the next operator can enter their own PIN.
const POINT_DEVICE_COOKIE = "point_device";
const POINT_DEVICE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const OPERATOR_SESSION_COOKIE = "operator_session";
const OPERATOR_SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

export const INSTALL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function hashInstallToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInstallToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInstallToken(token) };
}

export async function activatePointDevice(pointDeviceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(POINT_DEVICE_COOKIE, signToken(pointDeviceId), sessionCookieOptions(POINT_DEVICE_MAX_AGE));
}

async function getPointDeviceId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(POINT_DEVICE_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function createOperatorSession(operatorId: string) {
  const cookieStore = await cookies();
  cookieStore.set(OPERATOR_SESSION_COOKIE, signToken(operatorId), sessionCookieOptions(OPERATOR_SESSION_MAX_AGE));
}

export async function destroyOperatorSession() {
  const cookieStore = await cookies();
  cookieStore.delete(OPERATOR_SESSION_COOKIE);
}

export async function getOperatorSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OPERATOR_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Resolves the activated PointDevice + Point (and its tenant) from the
 * point_device cookie. Returns null if there's no cookie, the device was never
 * activated, or the device record no longer exists.
 */
export async function getActivatedDevice() {
  const pointDeviceId = await getPointDeviceId();
  if (!pointDeviceId) return null;

  const device = await prisma.pointDevice.findUnique({
    where: { id: pointDeviceId },
    include: { point: true },
  });
  if (!device || !device.activated) return null;

  return device;
}

export async function getActivatedPoint() {
  const device = await getActivatedDevice();
  return device?.point ?? null;
}

/**
 * PIN is unique only within a tenant, and bcrypt hashes can't be looked up by
 * value (random salt), so identifying "which operator just typed this PIN" means
 * scanning the tenant's operators and bcrypt-comparing each. Tenants are capped
 * at ~50 operators, so this is a non-issue performance-wise.
 *
 * There's no operator-picker step before the PIN, so a wrong PIN can't be
 * attributed to a specific operator to lock out — see PointDevice's own
 * failedPinAttempts/pinLockedUntil for the actual lockout, applied by the caller.
 */
// НЕ фильтрует по active — реальный баг, найден пользователем 2026-07-22
// (после того как деактивация Сотрудника стала доступна одним тапом на
// иконке статуса в списке/профиле, гораздо легче деактивировать по
// случайности, чем раньше через отдельную настройку): раньше деактивированный
// Сотрудник с ПРАВИЛЬНЫМ ПИН-кодом получал то же "Неверный ПИН-код", что и
// при реальной ошибке ввода — неотличимо снаружи. Вызывающий роут
// (/api/auth/operator/login) теперь сам проверяет operator.active и
// показывает точную причину.
export async function findOperatorByPin(tenantId: string, pin: string) {
  const operators = await prisma.operator.findMany({
    where: { tenantId },
  });

  for (const operator of operators) {
    if (await bcrypt.compare(pin, operator.pinHash)) {
      return operator;
    }
  }

  return null;
}

/** Uniqueness check when an Owner assigns/changes an operator's PIN. */
export async function isPinTakenInTenant(
  tenantId: string,
  pin: string,
  excludeOperatorId?: string
) {
  const operators = await prisma.operator.findMany({
    where: { tenantId, ...(excludeOperatorId ? { id: { not: excludeOperatorId } } : {}) },
  });

  for (const operator of operators) {
    if (await bcrypt.compare(pin, operator.pinHash)) {
      return true;
    }
  }

  return false;
}
