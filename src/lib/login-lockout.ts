import { prisma } from "@/lib/prisma";

// Блокировка аккаунта в базе после серии неверных попыток. Только пароль — у
// ПИН-кода такой блокировки больше нет (решение владельца 2026-08-08), его
// предел живёт в памяти и считается окном, см. lib/pin-attempts.ts.
//
// История, чтобы блокировку ПИНа не «вернули как забытую»: она была добавлена
// аудитом 2026-07-24 (5 попыток → 15 минут) и мешала работе точки. Хуже того,
// счётчик в базе не имел окна — обнулялся только удачным входом, поэтому
// накапливался неделями и срабатывал на людях, не на переборе (случай Park от
// 8 августа разобран в pin-attempts.ts).
//
// Пароль — другой случай: он не останавливает смену на точке, а перебор пароля
// Super Admin открывает все тенанты сразу. Порог щадящий для опечаток (5
// подряд, не 3). Окна у него нет намеренно: пять неверных паролей — это уже
// повод остановиться, кто бы их ни вводил.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function isLockedOut(lockedUntil: Date | null): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > Date.now();
}

export function remainingLockoutMinutes(lockedUntil: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
}

// Блокировка по паролю (Owner + Super Admin, оба через User.passwordHash) —
// аудит 2026-07-27, реальная дыра: вход по email+паролю не имел ВООБЩЕ никакой
// блокировки на уровне аккаунта — только in-memory rate-limit по IP
// (auth-rate-limit.ts), который (а) сбрасывается при каждом рестарте/деплое
// контейнера, (б) не имеет предела на КОНКРЕТНЫЙ аккаунт — атакующий с
// несколькими IP мог перебирать пароль известного email/login почти без
// ограничения, включая вход Super Admin (полный доступ ко всем тенантам).
//
// { increment: 1 }, не «прочитанное значение + 1» (аудит 2026-07-27, реальная
// дыра): читать счётчик заранее и писать attempts+1 отдельным update —
// классический TOCTOU race, при параллельных запросах несколько из них читают
// одно и то же значение ДО того, как любой из них закоммитит свой +1, и каждый
// пишет один и тот же «k+1» — счётчик никогда не достигает MAX_ATTEMPTS,
// сколько бы попыток ни отправили ОДНОВРЕМЕННО (не последовательно). SQL
// "SET x = x + 1" атомарен на уровне строки, поэтому { increment: 1 } закрывает
// гонку независимо от параллелизма; вторым update читаем УЖЕ инкрементированное
// значение и, если порог пройден, лочим — если несколько запросов одновременно
// пересекут порог, оба просто напишут примерно одинаковый passwordLockedUntil,
// это безвредно.
export async function recordFailedPassword(userId: string): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedPasswordAttempts: { increment: 1 } },
    select: { failedPasswordAttempts: true },
  });
  if (updated.failedPasswordAttempts >= MAX_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordLockedUntil: new Date(Date.now() + LOCKOUT_MS) },
    });
  }
}

export async function resetPasswordLockout(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { failedPasswordAttempts: 0, passwordLockedUntil: null } });
}
