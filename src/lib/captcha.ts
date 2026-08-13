import { randomUUID, timingSafeEqual } from "crypto";
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

// Одноразовость (аудит 2026-08-13). Токен по-прежнему stateless — в памяти
// живут только идентификаторы УЖЕ использованных задач, и не дольше TTL самого
// токена. До этого один раз решённую задачу можно было слать повторно все пять
// минут: ровно тот сценарий, ради которого капчу и ставили — бот решает один
// раз и регистрирует пачку кабинетов, а лимит по IP (10 за 5 минут) не мешает
// ему разложить это по адресам.
//
// Рестарт контейнера очищает список — как и у остальных in-memory ограничителей
// проекта (auth-rate-limit.ts, pin-attempts.ts): худшее, что даёт потеря
// состояния, — окно на повторное использование ещё не истёкшего токена, то
// есть ровно прежнее поведение, а не что-то новое.
const usedChallenges = new Map<string, number>();

function sweepUsedChallenges(now: number) {
  for (const [id, expiresAt] of usedChallenges) {
    if (expiresAt <= now) usedChallenges.delete(id);
  }
}

export function generateCaptchaChallenge(): CaptchaChallenge {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const useSubtraction = Math.random() < 0.5 && a >= b;
  const answer = useSubtraction ? a - b : a + b;
  const question = `${a} ${useSubtraction ? "−" : "+"} ${b}`;

  const exp = Date.now() + CAPTCHA_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ answer, exp, jti: randomUUID() })).toString("base64url");
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

  let decoded: { answer: number; exp: number; jti?: string };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  const now = Date.now();
  if (typeof decoded.exp !== "number" || now > decoded.exp) return false;

  const submitted = typeof answer === "number" ? answer : Number(answer);
  if (!Number.isFinite(submitted) || submitted !== decoded.answer) return false;

  // Гасим задачу только на ВЕРНОМ ответе: иначе один неверный ввод человека
  // (а капчу ошибаются набирать регулярно) требовал бы перезагрузки формы.
  // Токены без jti — выданные до этой правки, ещё живущие свои пять минут;
  // отвергать их значило бы сломать открытую в этот момент форму регистрации.
  if (decoded.jti) {
    sweepUsedChallenges(now);
    if (usedChallenges.has(decoded.jti)) return false;
    usedChallenges.set(decoded.jti, decoded.exp);
  }

  return true;
}
