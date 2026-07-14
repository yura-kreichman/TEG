import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { sessionCookieOptions, signExpiringToken, signToken, verifyExpiringToken, verifyToken } from "@/lib/session-crypto";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Separate cookie for Super Admin (found 2026-07-10: admin login shared the
// same "session" cookie as Owner, so logging into /admin in one tab silently
// logged the Owner out of another tab in the same browser — the "какая-то
// ошибка у Владельца" bug — Owner-scoped API calls then 401'd against an
// admin session that had overwritten it. Same signing scheme, own name/path
// so the two roles can be logged in simultaneously in one browser.
const ADMIN_SESSION_COOKIE = "admin_session";
// Короче, чем у Owner (docs/spec/06-super-admin.md, "короткий таймаут
// сессии") — платформенная панель, риск выше при утечке. Срок зашит в сам
// токен (signExpiringToken), не только в cookie maxAge — см. session-crypto.ts.
const ADMIN_SESSION_MAX_AGE = 60 * 60 * 2; // 2 hours

// Long-lived, separate from the session cookie: remembers which User (Owner/Super
// Admin) this browser last logged into, so a personal PIN can be entered without
// retyping the email. Not to be confused with PointDevice/operator sessions below —
// this is a personal-device convenience for account holders, not the operator kiosk flow.
const OWNER_DEVICE_COOKIE = "owner_device";
const OWNER_DEVICE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Отмечает, что текущая Owner-сессия (SESSION_COOKIE) была создана через
// Impersonate из /admin (docs/spec/06-super-admin.md, п.4), а не обычным
// логином владельца — хранит id админа, начавшего имперсонацию, чтобы
// баннер в кабинете владельца мог показать это и дать выйти обратно.
// Тот же maxAge, что у обычной Owner-сессии — истекает вместе с ней.
const IMPERSONATION_COOKIE = "impersonation";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function hashPin(pin: string) {
  return bcrypt.hash(pin, 12);
}

export function verifyPin(pin: string, hash: string) {
  return bcrypt.compare(pin, hash);
}

export async function createSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signToken(userId), sessionCookieOptions(SESSION_MAX_AGE));
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function createAdminSession(userId: string) {
  const cookieStore = await cookies();
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE * 1000;
  cookieStore.set(
    ADMIN_SESSION_COOKIE,
    signExpiringToken(userId, expiresAt),
    sessionCookieOptions(ADMIN_SESSION_MAX_AGE)
  );
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function getAdminSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyExpiringToken(token);
}

// Начинает имперсонацию — обычная Owner-сессия для ownerUserId (все
// существующие requireOwner()-проверки продолжают работать без изменений)
// плюс маркер, что это Admin вошёл от чужого имени. Admin'ская собственная
// сессия (ADMIN_SESSION_COOKIE) не трогается — админ не разлогинивается.
export async function startImpersonation(adminUserId: string, ownerUserId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signToken(ownerUserId), sessionCookieOptions(SESSION_MAX_AGE));
  cookieStore.set(IMPERSONATION_COOKIE, signToken(adminUserId), sessionCookieOptions(SESSION_MAX_AGE));
}

export async function getImpersonatingAdminId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// Выход из режима имперсонации — разлогинивает текущую (чужую) Owner-сессию;
// Admin возвращается в /admin на своей собственной, нетронутой сессии.
export async function endImpersonation() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(IMPERSONATION_COOKIE);
}

export async function rememberOwnerDevice(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(OWNER_DEVICE_COOKIE, signToken(userId), sessionCookieOptions(OWNER_DEVICE_MAX_AGE));
}

export async function forgetOwnerDevice() {
  const cookieStore = await cookies();
  cookieStore.delete(OWNER_DEVICE_COOKIE);
}

export async function getOwnerDeviceUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OWNER_DEVICE_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}
