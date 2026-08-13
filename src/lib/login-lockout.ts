import { verifySecret } from "@/lib/password-hash";
import { prisma } from "@/lib/prisma";

// Ограничение попыток входа по ПАРОЛЮ (Owner + Super Admin, оба через
// User.passwordHash). У ПИН-кода такой блокировки нет — его предел живёт в
// памяти окном, см. lib/pin-attempts.ts.
//
// История, чтобы не «вернули как забытое». Блокировка появилась аудитом
// 2026-07-24 и была переделана 2026-07-27: до неё вход по email+паролю не имел
// вообще никакого предела на КОНКРЕТНЫЙ аккаунт — только in-memory лимит по IP
// (auth-rate-limit.ts), который атакующий с несколькими адресами обходил почти
// свободно, включая вход Super Admin (полный доступ ко всем тенантам).
//
// Аудит 2026-08-13 нашёл цену той конструкции: 5 неверных паролей блокировали
// АККАУНТ на 15 минут, счётчик не имел окна, а сбрасывался только удачным
// входом. Значит любой, кто знает email владельца, мог держать его вне
// собственного кабинета сколько угодно долго — пять запросов раз в четверть
// часа, с любого адреса. Для SaaS, которым посменно работает точка, это не
// теория: конкурент или уволенный сотрудник знает адрес почты владельца.
// Тем же ответом утекало и существование аккаунта: 429 с текстом про
// блокировку приходил ТОЛЬКО для заведённых email, для незаведённых — всегда
// 401.
//
// Отсюда два уровня вместо одного.
//
// Уровень 1 — по паре (аккаунт + IP), в памяти, окном. Ловит обычный перебор
// (он всегда идёт с ограниченного числа адресов) и при этом физически не может
// закрыть владельцу вход: атакующий блокирует только собственный адрес, а
// владелец приходит со своего. Считается по ЛЮБОМУ введённому email, в том
// числе несуществующему — иначе разница в ответах сама по себе отвечала бы на
// вопрос «а заведён ли такой аккаунт».
//
// Уровень 2 — по аккаунту, в базе, тоже окном. Остаётся как страховка от
// распределённого перебора с многих адресов, ради которой блокировку и
// заводили. Порог намеренно высокий: человек с опечатками до него не доходит
// никогда, а атакующему нужно тридцать запросов ради пятнадцати минут — это
// уже не бесплатный DoS, как было, а размен, который ничего не даёт. Полностью
// убрать этот уровень нельзя: без него аккаунт снова остаётся без предела,
// именно этот регресс и чинил аудит 2026-07-27.
const PAIR_MAX_ATTEMPTS = 5;
const PAIR_WINDOW_MS = 15 * 60 * 1000;

const ACCOUNT_MAX_ATTEMPTS = 30;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Уровень 1: (аккаунт + IP), в памяти, скользящее окно.
// Тот же приём и та же оговорка, что у lib/pin-attempts.ts и
// lib/auth-rate-limit.ts: состояние не переживает рестарт контейнера, и для
// антибрутфорс-эвристики это приемлемо. Durable-часть — уровень 2 ниже.
// ---------------------------------------------------------------------------
const pairFailures = new Map<string, number[]>();

let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < PAIR_WINDOW_MS) return;
  lastSweep = now;
  for (const [key, timestamps] of pairFailures) {
    const fresh = timestamps.filter((t) => now - t < PAIR_WINDOW_MS);
    if (fresh.length === 0) pairFailures.delete(key);
    else pairFailures.set(key, fresh);
  }
}

// Ключ по введённому логину, а не по найденному userId: несуществующий email
// обязан считаться так же, как существующий, иначе ответы снова начнут
// различаться. Регистр приводим к нижнему — тем же правилом, что и поиск
// пользователя (lib/normalize-email.ts).
export function loginAttemptKey(login: string, ip: string): string {
  return `${login.trim().toLowerCase()}|${ip}`;
}

/** null — попытка разрешена; число — сколько минут ждать. */
export function loginBlockedForMinutes(key: string): number | null {
  const now = Date.now();
  sweep(now);

  const timestamps = (pairFailures.get(key) ?? []).filter((t) => now - t < PAIR_WINDOW_MS);
  if (timestamps.length < PAIR_MAX_ATTEMPTS) return null;

  // Ждать нужно не «пока остынут все попытки», а пока их станет меньше предела
  // (тот же расчёт, что в pin-attempts.ts): обещать больше, чем нужно, — это то
  // же самое, что блокировать дольше нужного.
  const oldestBlocking = timestamps[timestamps.length - PAIR_MAX_ATTEMPTS]!;
  return Math.max(1, Math.ceil((oldestBlocking + PAIR_WINDOW_MS - now) / 60000));
}

export function recordFailedLoginAttempt(key: string): void {
  const now = Date.now();
  sweep(now);
  const timestamps = (pairFailures.get(key) ?? []).filter((t) => now - t < PAIR_WINDOW_MS);
  timestamps.push(now);
  pairFailures.set(key, timestamps);
}

export function clearFailedLoginAttempts(key: string): void {
  pairFailures.delete(key);
}

// ---------------------------------------------------------------------------
// Уровень 2: аккаунт целиком, в базе, окном.
// ---------------------------------------------------------------------------

export function isLockedOut(lockedUntil: Date | null): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > Date.now();
}

export function remainingLockoutMinutes(lockedUntil: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
}

// { increment: 1 }, не «прочитанное значение + 1» (аудит 2026-07-27, реальная
// дыра): читать счётчик заранее и писать attempts+1 отдельным update —
// классический TOCTOU race, при параллельных запросах несколько из них читают
// одно и то же значение ДО того, как любой из них закоммитит свой +1, и каждый
// пишет один и тот же «k+1» — счётчик никогда не достигает предела, сколько бы
// попыток ни отправили ОДНОВРЕМЕННО (не последовательно). SQL "SET x = x + 1"
// атомарен на уровне строки, поэтому { increment: 1 } закрывает гонку
// независимо от параллелизма.
//
// failedPasswordFirstAt — начало окна (аудит 2026-08-13). Без него счётчик
// накапливался за всё время с последнего удачного входа: у владельца, который
// заходит раз в неделю, пять промахов копились месяцами и срабатывали на
// человеке, а не на переборе — ровно та же ошибка, что 8 августа разобрали у
// ПИНа (см. lib/pin-attempts.ts, случай Park).
export async function recordFailedPassword(userId: string): Promise<void> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedPasswordFirstAt: true },
  });

  const windowExpired =
    !user?.failedPasswordFirstAt || now.getTime() - user.failedPasswordFirstAt.getTime() > ACCOUNT_WINDOW_MS;

  if (windowExpired) {
    await prisma.user.update({
      where: { id: userId },
      data: { failedPasswordAttempts: 1, failedPasswordFirstAt: now },
    });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedPasswordAttempts: { increment: 1 } },
    select: { failedPasswordAttempts: true },
  });
  if (updated.failedPasswordAttempts >= ACCOUNT_MAX_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordLockedUntil: new Date(Date.now() + ACCOUNT_LOCKOUT_MS),
        failedPasswordAttempts: 0,
        failedPasswordFirstAt: null,
      },
    });
  }
}

export async function resetPasswordLockout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedPasswordAttempts: 0, failedPasswordFirstAt: null, passwordLockedUntil: null },
  });
}

// ---------------------------------------------------------------------------
// Выравнивание времени ответа для несуществующего аккаунта.
// ---------------------------------------------------------------------------

// Хеш-пустышка от случайной строки: сравнение с ним всегда неуспешно, но стоит
// ровно столько же, сколько настоящая проверка пароля (bcryptjs, cost=12 —
// ~285 мс, замерено). Без него ответ «такого email нет» приходил мгновенно, а
// «email есть, пароль неверный» — через треть секунды: разница в сотни
// миллисекунд надёжно измеряется по сети и отвечает на вопрос, заведён ли
// аккаунт, даже когда текст ответа одинаковый (аудит 2026-08-13).
// Константа, а не генерация на каждый запрос: хеширование дороже сравнения, и
// его стоимость как раз не должна попадать в измеряемое время.
const DUMMY_HASH = "$2b$12$RZ408b1VGwVQ0NpZdmQvDOCkkSz01Lfe/YXYMJOoS4MXg4voihFTm";

/**
 * Тратит столько же времени, сколько потратила бы настоящая проверка пароля.
 * Вызывается на ветке «пользователь не найден» перед общим 401.
 */
export async function equalizePasswordTiming(password: string): Promise<void> {
  await verifySecret(password, DUMMY_HASH).catch(() => false);
}
