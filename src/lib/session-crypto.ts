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

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
