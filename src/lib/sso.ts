import crypto from "node:crypto";

/**
 * Единый вход: RentOS — источник входа, rentos365.app — потребитель (решение
 * пользователя 2026-08-08). Обратное направление сознательно не делается: у
 * приложения своя авторизация с тенантами, ролями и PIN-ами, и сделать
 * WordPress хозяином этих аккаунтов означало бы защитить кассы всех тенантов
 * плагином на маркетинговом сайте.
 */

// Минута: кода хватает ровно на редирект браузера обратно на сайт. Он ещё и
// одноразовый (SsoCode.usedAt), так что срок — второй рубеж, а не первый.
export const SSO_CODE_TTL_MS = 60 * 1000;

export function generateSsoCode(): { code: string; codeHash: string } {
  const code = crypto.randomBytes(32).toString("hex");
  return { code, codeHash: hashSsoCode(code) };
}

// Хеш, не сам код — тот же приём, что у reset-токена (см. lib/auth.ts).
// SHA-256 без соли здесь достаточен: код случайный, 256 бит, живёт минуту —
// подбирать нечего, а от утечки таблицы это защищает.
export function hashSsoCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Куда разрешено возвращать браузер с кодом. Без белого списка это открытый
 * редирект, и код единого входа уезжал бы на чужой домен вместе с
 * пользователем — то есть тихий вход в чужой кабинет.
 *
 * Список — origin'ы через запятую в SSO_ALLOWED_ORIGINS. Пусто = единый вход
 * выключен целиком, а не "разрешено всё": незаполненная переменная окружения не
 * должна открывать дверь.
 */
export function isAllowedRedirectUri(redirectUri: string): boolean {
  const allowed = (process.env.SSO_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.length === 0) return false;

  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  // Только https: код в открытом http перехватывается по пути.
  if (url.protocol !== "https:") return false;

  return allowed.includes(url.origin);
}
