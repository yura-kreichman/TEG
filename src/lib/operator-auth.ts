import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { verifySecret } from "@/lib/password-hash";
import { prisma } from "@/lib/prisma";
import { sessionCookieOptions, signExpiringToken, verifyExpiringToken } from "@/lib/session-crypto";

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
  // verifyExpiringToken, а НЕ verifySessionToken (авария на проде 2026-08-13).
  // Эта кука выдаётся signExpiringToken — три части. verifySessionToken в тот
  // же день стал понимать ТОЛЬКО четырёхчастный формат сессии владельца, и
  // разбор здесь начал возвращать null: устройства всех точек разом стали
  // «не активированными», сотрудники не смогли войти, а владельцу пришлось бы
  // выпускать новые ссылки активации. Куки при этом были и остаются валидными
  // — их просто проверяли не той функцией. Формат этой куки не менялся, менять
  // его тут нельзя: устройства активируются один раз и живут год.
  return verifyExpiringToken(token);
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
  // verifyExpiringToken — см. комментарий у getPointDeviceId выше.
  return verifyExpiringToken(token);
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
 * value (random salt), so identifying "which operator just typed this PIN" used
 * to mean scanning the tenant's operators and bcrypt-comparing each.
 *
 * Почему так больше нельзя (аудит 2026-08-13, замерено, а не оценено на глаз):
 * bcryptjs (чистый JS, не нативный bcrypt) на cost=12 даёт ~285 мс на ОДНО
 * сравнение. Полный перебор на неверном ПИНе — это все сотрудники тенанта:
 * при 50 сотрудниках 14,3 с CPU на один HTTP-запрос. Предел неверных ПИНов —
 * 20 за 5 минут на устройство, то есть одно устройство точки могло заказать
 * почти пять минут чистого CPU за пять минут; несколько планшетов клали
 * приложение целиком. Плюс тайминг-канал: верный ПИН находится в среднем на
 * середине списка, и время ответа выдавало позицию сотрудника в нём.
 *
 * Отбор кандидата теперь идёт индексом по Operator.pin — той самой колонке с
 * ПИНом открытым текстом, которая и так существует с 2026-07-14 (Владелец
 * может посмотреть ПИН сотрудника повторно). Новой утечки это не создаёт:
 * значение уже лежало в этой строке, просто теперь по нему есть индекс
 * (@@index([tenantId, pin]) в schema.prisma).
 *
 * bcrypt-проверка ОСТАЁТСЯ и остаётся единственным источником истины: pin —
 * только индекс, доступ даёт исключительно совпадение с pinHash. Если бы кто-то
 * правил pin в обход приложения, вход по нему всё равно не прошёл бы.
 *
 * Строки без pin (заведённые до появления колонки) индексом не находятся —
 * для них остаётся прежний перебор, но только по ним, и на успешном входе
 * колонка дозаполняется. То есть миграция доигрывается сама, по мере входов,
 * без разового скрипта: восстановить pin можно только в момент, когда ПИН
 * реально введён — из bcrypt-хеша он не достаётся by design.
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
  const indexed = await prisma.operator.findFirst({ where: { tenantId, pin } });
  if (indexed && (await verifySecret(pin, indexed.pinHash))) {
    return indexed;
  }

  const legacy = await prisma.operator.findMany({ where: { tenantId, pin: null } });
  for (const operator of legacy) {
    if (await verifySecret(pin, operator.pinHash)) {
      // Дозаполняем индексную колонку — этот сотрудник больше не попадёт в
      // перебор. Не блокируем вход, если запись почему-то не удалась.
      await prisma.operator
        .update({ where: { id: operator.id }, data: { pin } })
        .catch(() => {});
      return operator;
    }
  }

  return null;
}

/**
 * Uniqueness check when an Owner assigns/changes an operator's PIN.
 * Тот же индексный отбор, что и у findOperatorByPin, с тем же остатком-перебором
 * по строкам без открытой колонки — здесь он не на горячем пути (действие
 * Владельца, не вход на точке), но лишние 14 секунд в форме тоже не нужны.
 */
export async function isPinTakenInTenant(
  tenantId: string,
  pin: string,
  excludeOperatorId?: string
) {
  const exclude = excludeOperatorId ? { id: { not: excludeOperatorId } } : {};

  const indexed = await prisma.operator.findFirst({ where: { tenantId, pin, ...exclude } });
  if (indexed && (await verifySecret(pin, indexed.pinHash))) {
    return true;
  }

  const legacy = await prisma.operator.findMany({ where: { tenantId, pin: null, ...exclude } });
  for (const operator of legacy) {
    if (await verifySecret(pin, operator.pinHash)) {
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
    if (owner.pinHash && (await verifySecret(pin, owner.pinHash))) {
      return true;
    }
  }

  return false;
}
