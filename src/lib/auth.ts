import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { hashSecret, verifySecret } from "@/lib/password-hash";
import {
  sessionCookieOptions,
  signExpiringToken,
  signSessionToken,
  verifyExpiringToken,
  verifySessionDetails,
  type SessionTokenDetails,
} from "@/lib/session-crypto";
import { ENDLESS_COOKIE_MAX_AGE, OWNER_DEVICE_COOKIE, SESSION_COOKIE } from "@/lib/endless-cookies";

// Бессрочно (решение владельца 2026-09-24): 400 дней с продлением при каждом
// открытии приложения, см. lib/endless-cookies.ts. Раньше — ровно 7 дней от
// входа, и владелец раз в неделю вылетал на экран ПИН-кода.
const SESSION_MAX_AGE = ENDLESS_COOKIE_MAX_AGE;

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
// Бессрочно (решение владельца 2026-08-16, уточнено 2026-09-17). От этой привязки
// зависит не только подстановка почты, но и кнопка «Войти как Владелец» на
// экране входа сотрудника — единственный переход в кабинет с телефона, где
// человек работает и владельцем, и сотрудником. Истечение через год молча
// убирало бы эту кнопку у того, кто ей год не пользовался, и выглядело бы
// как пропажа кабинета. Риска в долгом сроке нет: cookie лишь показывает
// форму входа, а сам вход по-прежнему требует пароль или личный PIN; на
// планшетах точки её не бывает вовсе, и кнопка там не появляется.
// Прежние «10 лет» были иллюзией — браузер держит куку не дольше 400 дней;
// бессрочность даёт продление на каждом визите, см. lib/endless-cookies.ts.
const OWNER_DEVICE_MAX_AGE = ENDLESS_COOKIE_MAX_AGE;

// Отмечает, что текущая Owner-сессия (SESSION_COOKIE) была создана через
// Impersonate из /admin (docs/spec/06-super-admin.md, п.4), а не обычным
// логином владельца — хранит id админа, начавшего имперсонацию, чтобы
// баннер в кабинете владельца мог показать это и дать выйти обратно.
// Тот же maxAge, что у обычной Owner-сессии — истекает вместе с ней.
const IMPERSONATION_COOKIE = "impersonation";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashPassword(password: string) {
  return hashSecret(password);
}

export function verifyPassword(password: string, hash: string) {
  return verifySecret(password, hash);
}

export function hashPin(pin: string) {
  return hashSecret(pin);
}

export function verifyPin(pin: string, hash: string) {
  return verifySecret(pin, hash);
}

export async function createSession(userId: string) {
  const cookieStore = await cookies();
  // Сброс IMPERSONATION_COOKIE (аудит 2026-07-31) — реальный баг: Admin
  // имперсонировал Owner'а A и не вышел явно (impersonation-cookie живёт
  // ADMIN_SESSION_MAX_AGE = 2ч), затем на том же браузере ДРУГОЙ, ни при чём
  // не причастный Owner B логинится обычным способом — createSession
  // перезаписывает SESSION_COOKIE на B, но старый IMPERSONATION_COOKIE
  // (валидный, указывает на админа) оставался нетронутым. /api/auth/impersonation
  // видел оба валидных cookie и честно, но ложно репортил "вы имперсонируете
  // тенант B" — а кнопка "выйти из режима" (endImpersonation) удаляла
  // настоящую сессию B и перебрасывала на /admin. startImpersonation НЕ
  // ходит через createSession (ставит оба cookie сама), поэтому этот сброс
  // не задевает саму имперсонацию — только обычный логин/регистрацию.
  cookieStore.delete(IMPERSONATION_COOKIE);
  // Срок и время выдачи зашиты в сам токен (аудит 2026-07-27, 2026-08-13):
  // перехваченный сырой cookie (лог прокси, скриншот, бэкап устройства) при
  // прямом реплее без браузера не должен жить вечно, а смена или сброс пароля
  // должны его обесценивать. С 2026-09-24 сессия бессрочная (продлевается
  // при открытии приложения, lib/endless-cookies.ts), поэтому от перехвата
  // защищает уже не срок, а только отзыв: смена пароля ставит
  // User.sessionsValidFrom, и продление время выдачи не трогает.
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_MAX_AGE * 1000;
  cookieStore.set(
    SESSION_COOKIE,
    signSessionToken(userId, issuedAt, expiresAt),
    sessionCookieOptions(SESSION_MAX_AGE)
  );
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// Полные данные сессии, включая время выдачи — его сверяет с
// User.sessionsValidFrom тот, кто и так читает пользователя из базы
// (requireOwner). Здесь запроса к базе намеренно нет.
export async function getSession(): Promise<SessionTokenDetails | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionDetails(token);
}

export async function getSessionUserId(): Promise<string | null> {
  return (await getSession())?.userId ?? null;
}

export async function createAdminSession(userId: string) {
  const cookieStore = await cookies();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ADMIN_SESSION_MAX_AGE * 1000;
  cookieStore.set(
    ADMIN_SESSION_COOKIE,
    signSessionToken(userId, issuedAt, expiresAt),
    sessionCookieOptions(ADMIN_SESSION_MAX_AGE)
  );
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function getAdminSession(): Promise<SessionTokenDetails | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionDetails(token);
}

export async function getAdminSessionUserId(): Promise<string | null> {
  return (await getAdminSession())?.userId ?? null;
}

// Начинает имперсонацию — Owner-сессия для ownerUserId (все существующие
// requireOwner()-проверки продолжают работать без изменений, formaт токена
// им прозрачен) плюс маркер, что это Admin вошёл от чужого имени.
// Admin'ская собственная сессия (ADMIN_SESSION_COOKIE) не трогается — админ
// не разлогинивается. ОБА токена — тем же коротким self-expiring форматом и
// сроком, что у самой admin-сессии (аудит 2026-07-25: раньше здесь был
// обычный signToken с 7-дневным SESSION_MAX_AGE — имперсонированная
// Owner-сессия технически могла пережить 2-часовую сессию запустившего её
// админа, а перехваченное сырое значение cookie оставалось валидным без
// browser maxAge вообще, см. комментарий у signExpiringToken).
export async function startImpersonation(adminUserId: string, ownerUserId: string) {
  const cookieStore = await cookies();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ADMIN_SESSION_MAX_AGE * 1000;
  cookieStore.set(
    SESSION_COOKIE,
    signSessionToken(ownerUserId, issuedAt, expiresAt),
    sessionCookieOptions(ADMIN_SESSION_MAX_AGE)
  );
  cookieStore.set(
    IMPERSONATION_COOKIE,
    signExpiringToken(adminUserId, expiresAt),
    sessionCookieOptions(ADMIN_SESSION_MAX_AGE)
  );
}

export async function getImpersonatingAdminId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (!token) return null;
  return verifyExpiringToken(token);
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
  // signExpiringToken (аудит 2026-07-27) — тот же "перехваченный cookie живёт
  // вечно" пробел, что и у createSession выше, но здесь ставки выше: этот
  // cookie живёт год. verifySessionToken (не verifyToken) ниже — совместимый
  // диспетчер формата, старые уже выданные 2-частные cookie не ломаются.
  const expiresAt = Date.now() + OWNER_DEVICE_MAX_AGE * 1000;
  cookieStore.set(
    OWNER_DEVICE_COOKIE,
    signExpiringToken(userId, expiresAt),
    sessionCookieOptions(OWNER_DEVICE_MAX_AGE)
  );
}

export async function forgetOwnerDevice() {
  const cookieStore = await cookies();
  cookieStore.delete(OWNER_DEVICE_COOKIE);
}

export async function getOwnerDeviceUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OWNER_DEVICE_COOKIE)?.value;
  if (!token) return null;
  // verifyExpiringToken напрямую (аудит 2026-08-13): раньше здесь стоял
  // диспетчер форматов ради ещё более старых 2-частных кук — их давно нет,
  // а сам диспетчер теперь понимает только формат сессии, не этот.
  return verifyExpiringToken(token);
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}
