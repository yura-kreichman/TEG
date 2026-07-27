import { prisma } from "@/lib/prisma";

// Блокировка по попыткам подбора ПИН-кода (Owner personal PIN и Operator
// device PIN) — реальная дыра, найдена аудитом 2026-07-24: поля
// User.failedPinAttempts/pinLockedUntil и PointDevice.failedPinAttempts/
// pinLockedUntil существовали в схеме (миграция 20260706112125_pin_lockout_
// on_point_device) и только ОБНУЛЯЛИСЬ (при установке нового PIN/сбросе
// пароля), но ни один вызывающий роут их не инкрементировал и не проверял —
// 4-значный ПИН (10000 комбинаций) подбирался без единого препятствия.
//
// Порог и окно — намеренно щадящие для реальных опечаток (5 подряд, не 3),
// но кардинально закрывающие перебор (5 попыток / 15 минут ≈ 480/сутки —
// подбор 10000 комбинаций растягивается на недели вместо секунд).
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function isPinLockedOut(pinLockedUntil: Date | null): boolean {
  return pinLockedUntil !== null && pinLockedUntil.getTime() > Date.now();
}

export function remainingLockoutMinutes(pinLockedUntil: Date): number {
  return Math.max(1, Math.ceil((pinLockedUntil.getTime() - Date.now()) / 60000));
}

// { increment: 1 }, не "прочитанное значение + 1" (аудит 2026-07-27,
// реальная дыра): читать currentAttempts заранее и писать attempts+1 отдельным
// update — классический TOCTOU race, при параллельных запросах несколько из
// них читают одно и то же currentAttempts ДО того, как любой из них закоммитит
// свой +1, и каждый пишет один и тот же "k+1" — счётчик никогда не достигает
// MAX_ATTEMPTS, сколько бы попыток подряд ни отправили ОДНОВРЕМЕННО (не
// последовательно). SQL "SET x = x + 1" атомарен на уровне строки, поэтому
// { increment: 1 } закрывает гонку независимо от параллелизма; вторым
// отдельным update читаем УЖЕ инкрементированное значение и, если порог
// пройден, лочим — если несколько запросов одновременно пересекут порог,
// оба просто напишут примерно одинаковый pinLockedUntil, это безвредно.
export async function recordFailedOwnerPin(userId: string): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedPinAttempts: { increment: 1 } },
    select: { failedPinAttempts: true },
  });
  if (updated.failedPinAttempts >= MAX_ATTEMPTS) {
    await prisma.user.update({ where: { id: userId }, data: { pinLockedUntil: new Date(Date.now() + LOCKOUT_MS) } });
  }
}

export async function resetOwnerPinLockout(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
}

// Блокировка живёт на PointDevice, не на Operator — ПИН проверяется сканом
// ВСЕХ операторов тенанта на одном устройстве (findOperatorByPin), нет
// отдельного "кто именно ошибся", поэтому лочится сама точка входа
// (устройство), тот же принцип, что уже описан в комментарии у
// findOperatorByPin в lib/operator-auth.ts.
// { increment: 1 } — см. комментарий у recordFailedOwnerPin выше, тот же фикс.
export async function recordFailedDevicePin(deviceId: string): Promise<void> {
  const updated = await prisma.pointDevice.update({
    where: { id: deviceId },
    data: { failedPinAttempts: { increment: 1 } },
    select: { failedPinAttempts: true },
  });
  if (updated.failedPinAttempts >= MAX_ATTEMPTS) {
    await prisma.pointDevice.update({
      where: { id: deviceId },
      data: { pinLockedUntil: new Date(Date.now() + LOCKOUT_MS) },
    });
  }
}

export async function resetDevicePinLockout(deviceId: string): Promise<void> {
  await prisma.pointDevice.update({ where: { id: deviceId }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
}

// Блокировка по паролю (Owner + Super Admin, оба через User.passwordHash) —
// аудит 2026-07-27, второй раунд, реальная дыра: вход по email+паролю не
// имел ВООБЩЕ никакой блокировки на уровне аккаунта — только in-memory
// rate-limit по IP (auth-rate-limit.ts), который (а) сбрасывается при каждом
// рестарте/деплое контейнера, (б) не имеет предела на КОНКРЕТНЫЙ аккаунт —
// атакующий с несколькими IP мог перебирать пароль известного email/login
// почти без ограничения, включая вход Super Admin (полный доступ ко всем
// тенантам). isPinLockedOut/remainingLockoutMinutes переиспользуются как есть
// — они уже полностью общие (принимают просто Date|null), ничего специфичного
// для ПИНа в них нет.
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
