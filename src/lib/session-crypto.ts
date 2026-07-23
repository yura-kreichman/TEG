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

export function signToken(id: string) {
  return `${id}.${sign(id)}`;
}

export function verifyToken(token: string): string | null {
  const [id, signature] = token.split(".");
  if (!id || !signature) return null;

  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return id;
}

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

// Диспетчер формата для cookie "session" — она несёт ЛИБО обычный
// signToken (id.signature, 1 точка, обычный логин владельца), ЛИБО
// signExpiringToken (id.expiresAt.signature, 2 точки, сессия имперсонации из
// startImpersonation в lib/auth.ts — тот же короткий серверный таймаут, что у
// собственной сессии админа). Общий для lib/auth.ts (getSessionUserId) и
// edge-мидлвара (proxy.ts, который читает cookie напрямую, в обход
// getSessionUserId, и раньше не понимал формат имперсонации вовсе).
export function verifySessionToken(token: string): string | null {
  return token.split(".").length === 3 ? verifyExpiringToken(token) : verifyToken(token);
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
