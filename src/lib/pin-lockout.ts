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

export async function recordFailedOwnerPin(userId: string, currentAttempts: number): Promise<void> {
  const attempts = currentAttempts + 1;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedPinAttempts: attempts,
      ...(attempts >= MAX_ATTEMPTS ? { pinLockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
    },
  });
}

export async function resetOwnerPinLockout(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
}

// Блокировка живёт на PointDevice, не на Operator — ПИН проверяется сканом
// ВСЕХ операторов тенанта на одном устройстве (findOperatorByPin), нет
// отдельного "кто именно ошибся", поэтому лочится сама точка входа
// (устройство), тот же принцип, что уже описан в комментарии у
// findOperatorByPin в lib/operator-auth.ts.
export async function recordFailedDevicePin(deviceId: string, currentAttempts: number): Promise<void> {
  const attempts = currentAttempts + 1;
  await prisma.pointDevice.update({
    where: { id: deviceId },
    data: {
      failedPinAttempts: attempts,
      ...(attempts >= MAX_ATTEMPTS ? { pinLockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
    },
  });
}

export async function resetDevicePinLockout(deviceId: string): Promise<void> {
  await prisma.pointDevice.update({ where: { id: deviceId }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
}
