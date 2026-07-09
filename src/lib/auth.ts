import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Separate cookie for Super Admin (found 2026-07-10: admin login shared the
// same "session" cookie as Owner, so logging into /admin in one tab silently
// logged the Owner out of another tab in the same browser — the "какая-то
// ошибка у Владельца" bug — Owner-scoped API calls then 401'd against an
// admin session that had overwritten it. Same signing scheme, own name/path
// so the two roles can be logged in simultaneously in one browser.
const ADMIN_SESSION_COOKIE = "admin_session";

// Long-lived, separate from the session cookie: remembers which User (Owner/Super
// Admin) this browser last logged into, so a personal PIN can be entered without
// retyping the email. Not to be confused with PointDevice/operator sessions below —
// this is a personal-device convenience for account holders, not the operator kiosk flow.
const OWNER_DEVICE_COOKIE = "owner_device";
const OWNER_DEVICE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const PIN_LOCK_THRESHOLD = 5;
export const PIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

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

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function signToken(id: string) {
  const signature = sign(id);
  return `${id}.${signature}`;
}

function verifyToken(token: string): string | null {
  const [id, signature] = token.split(".");
  if (!id || !signature) return null;

  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return id;
}

export async function createSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
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
  cookieStore.set(ADMIN_SESSION_COOKIE, signToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function getAdminSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function rememberOwnerDevice(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(OWNER_DEVICE_COOKIE, signToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OWNER_DEVICE_MAX_AGE,
  });
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
