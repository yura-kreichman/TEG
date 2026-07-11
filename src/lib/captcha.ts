import { timingSafeEqual } from "crypto";
import { sign } from "@/lib/session-crypto";

// Lightweight arithmetic captcha for /register (docs feedback 2026-07-10) —
// stops generic spam bots that blindly fill every field of a form, not a
// serious anti-abuse measure. Deliberately no third-party service (reCAPTCHA
// etc.) — same self-hosted philosophy as the rest of auth. Stateless: the
// expected answer is embedded in a signed token (same HMAC scheme as session
// tokens, see src/lib/session-crypto.ts), so there's no server-side challenge store.
const CAPTCHA_TTL_MS = 5 * 60 * 1000; // 5 minutes — enough to fill the form, short enough to limit replay

export interface CaptchaChallenge {
  question: string;
  token: string;
}

export function generateCaptchaChallenge(): CaptchaChallenge {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const useSubtraction = Math.random() < 0.5 && a >= b;
  const answer = useSubtraction ? a - b : a + b;
  const question = `${a} ${useSubtraction ? "−" : "+"} ${b}`;

  const payload = Buffer.from(JSON.stringify({ answer, exp: Date.now() + CAPTCHA_TTL_MS })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;

  return { question, token };
}

export function verifyCaptchaAnswer(token: unknown, answer: unknown): boolean {
  if (typeof token !== "string") return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  let decoded: { answer: number; exp: number };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (typeof decoded.exp !== "number" || Date.now() > decoded.exp) return false;

  const submitted = typeof answer === "number" ? answer : Number(answer);
  return Number.isFinite(submitted) && submitted === decoded.answer;
}
