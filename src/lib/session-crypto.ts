import { createHmac, timingSafeEqual } from "crypto";

// Shared HMAC-signing scheme for every stateless token in the app (Owner/Admin
// session, owner-device remember-me, operator session, point-device, and the
// /register captcha token in src/lib/captcha.ts) — previously copy-pasted
// identically across those modules; factored out so a future change to the
// signing scheme can't be applied to one and forgotten in the others.

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

export function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

// signToken/verifyToken (бессрочный формат `id.signature`) удалены аудитом
// 2026-08-13. Выпускать их перестали ещё 2026-07-27, но функция разбора
// оставалась и продолжала их принимать — а токен без срока действия при
// прямом реплее (без браузера, минуя maxAge cookie) валиден вечно. Ни один
// вызывающий их больше не использует: session/admin_session — signSessionToken
// ниже, owner_device/операторские/устройство точки — signExpiringToken.

// Обычный signToken/verifyToken не несёт срок действия вообще — "таймаут"
// сессии обеспечивает только maxAge cookie в браузере, а перехваченное сырое
// значение cookie остаётся валидным навсегда при прямом реплее (без
// браузера). Для admin-сессии это реальное требование безопасности
// (docs/spec/06-super-admin.md, "короткий таймаут сессии"), не просто
// cookie-удобство — поэтому здесь срок действия зашит в подписываемое
// значение и проверяется на сервере, а не только доверяется клиенту.
export function signExpiringToken(id: string, expiresAtMs: number): string {
  const payload = `${id}.${expiresAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyExpiringToken(token: string): string | null {
  const [id, expiresAtStr, signature] = token.split(".");
  if (!id || !expiresAtStr || !signature) return null;

  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;

  const expected = sign(`${id}.${expiresAtStr}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return id;
}

// Формат cookie "session" и "admin_session" (аудит 2026-08-13): к id и сроку
// добавлено ВРЕМЯ ВЫДАЧИ. Оно нужно ровно для одного — чтобы смена пароля
// могла разом обесценить все ранее выданные сессии: подпись зависит только от
// userId, поэтому «выпустить новый токен» никогда не отзывало старый, и
// перехваченное значение продолжало работать до конца своего срока даже после
// того, как владелец сменил пароль именно из-за подозрения на перехват.
// Сверка идёт с User.sessionsValidFrom в requireOwner/requireSuperAdmin — там,
// где пользователь и так читается из базы, без лишнего запроса.
export interface SessionTokenDetails {
  userId: string;
  issuedAtMs: number;
}

export function signSessionToken(id: string, issuedAtMs: number, expiresAtMs: number): string {
  const payload = `${id}.${issuedAtMs}.${expiresAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionDetails(token: string): SessionTokenDetails | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, issuedAtStr, expiresAtStr, signature] = parts as [string, string, string, string];
  if (!id || !issuedAtStr || !expiresAtStr || !signature) return null;

  const issuedAtMs = Number(issuedAtStr);
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return null;
  if (Date.now() > expiresAtMs) return null;

  const expected = sign(`${id}.${issuedAtStr}.${expiresAtStr}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { userId: id, issuedAtMs };
}

// Только userId — для proxy.ts, который читает cookie напрямую (гейт подписки)
// и про время выдачи ничего не решает.
//
// Прежние форматы больше НЕ принимаются. Раньше здесь стоял диспетчер: 1 точка
// — бессрочный signToken, 2 точки — signExpiringToken. Бессрочные токены никто
// не выпускает с 2026-07-27, их браузерный maxAge (7 дней) истёк ещё в начале
// августа, а ветка разбора продолжала жить и принимать их — то есть кука,
// перехваченная до той даты, оставалась годной НАВСЕГДА при прямом реплее без
// браузера. Совместимость закончилась; при выкатке все текущие сессии
// владельцев и админов станут недействительны один раз — это ожидаемо и
// дешевле, чем держать открытой вечную дверь.
export function verifySessionToken(token: string): string | null {
  return verifySessionDetails(token)?.userId ?? null;
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
