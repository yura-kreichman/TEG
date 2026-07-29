import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sessionCookieOptions, signExpiringToken, verifySessionToken } from "@/lib/session-crypto";

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
  // signExpiringToken (аудит 2026-07-27) — тот же класс бага, что и у
  // Owner-сессии (src/lib/auth.ts): обычный signToken не несёт срок действия
  // в самом значении, перехваченный сырой cookie (этот живёт год) оставался
  // бы валиден навсегда при прямом реплее. verifySessionToken ниже понимает
  // оба формата — уже активированные устройства не отваливаются.
  const expiresAt = Date.now() + POINT_DEVICE_MAX_AGE * 1000;
  cookieStore.set(
    POINT_DEVICE_COOKIE,
    signExpiringToken(pointDeviceId, expiresAt),
    sessionCookieOptions(POINT_DEVICE_MAX_AGE)
  );
}

async function getPointDeviceId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(POINT_DEVICE_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function createOperatorSession(operatorId: string) {
  const cookieStore = await cookies();
  // signExpiringToken (аудит 2026-07-27) — см. комментарий у activatePointDevice.
  const expiresAt = Date.now() + OPERATOR_SESSION_MAX_AGE * 1000;
  cookieStore.set(
    OPERATOR_SESSION_COOKIE,
    signExpiringToken(operatorId, expiresAt),
    sessionCookieOptions(OPERATOR_SESSION_MAX_AGE)
  );
}

export async function destroyOperatorSession() {
  const cookieStore = await cookies();
  cookieStore.delete(OPERATOR_SESSION_COOKIE);
}

export async function getOperatorSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OPERATOR_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
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

// Реальный риск, найден пользователем 2026-07-29 (обсуждение "Войти как
// Владелец" на экране входа Сотрудника): ПИН оператора — рабочий секрет,
// известный персоналу точки, а ПИН Владельца открывает полный кабинет —
// если они случайно совпадут, любой, кто знает ПИН оператора, сможет
// зайти и Владельцем. Проверка в ОБЕ стороны: при назначении/смене ПИНа
// оператору (см. api/operators/route.ts, api/operators/[id]/reset-pin) —
// не должен совпасть с личным ПИНом ни одного Owner-пользователя этого
// тенанта; и наоборот, при смене личного ПИНа Владельцем (api/auth/pin) —
// не должен совпасть ни с одним операторским. Owner-пользователей у
// тенанта в теории может быть больше одного (tenantId не @unique в
// схеме) — проверяем всех, не только текущего.
export async function isOwnerPinInTenant(tenantId: string, pin: string) {
  const owners = await prisma.user.findMany({
    where: { tenantId, role: "owner", pinHash: { not: null } },
  });

  for (const owner of owners) {
    if (owner.pinHash && (await bcrypt.compare(pin, owner.pinHash))) {
      return true;
    }
  }

  return false;
}
