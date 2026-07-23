import { NextResponse } from "next/server";
import {
  createOperatorSession,
  findOperatorByPin,
  getActivatedDevice,
} from "@/lib/operator-auth";
import { setAccentCookie } from "@/lib/accent";
import { getPreAuthLocaleCookie } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import {
  isPinLockedOut,
  recordFailedDevicePin,
  remainingLockoutMinutes,
  resetDevicePinLockout,
} from "@/lib/pin-lockout";
import { isAuthRateLimited } from "@/lib/auth-rate-limit";
import { getClientIp } from "@/lib/instructions/request-ip";

export async function POST(request: Request) {
  // Второй, независимый слой поверх PIN-блокировки самого устройства — та
  // защищает от перебора ОДНОГО конкретного устройства, но не мешает
  // атакующему с сетевым доступом к нескольким киоскам/подделанной
  // point_device-кукой распределить перебор (аудит 2026-07-24).
  if (isAuthRateLimited("operator-login", getClientIp(request))) {
    return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
  }

  const device = await getActivatedDevice();
  if (!device) {
    return NextResponse.json(
      { error: "Это устройство ещё не привязано к точке. Обратитесь к владельцу." },
      { status: 400 }
    );
  }

  // Блокировка по попыткам — на устройстве, не на операторе (аудит
  // 2026-07-24, реальная дыра — поля были в схеме, но нигде не
  // использовались; ПИН проверяется сканом ВСЕХ операторов тенанта на одном
  // устройстве, нет отдельного "кто ошибся", см. lib/pin-lockout.ts).
  if (isPinLockedOut(device.pinLockedUntil)) {
    return NextResponse.json(
      { error: `Слишком много попыток. Попробуйте через ${remainingLockoutMinutes(device.pinLockedUntil!)} мин.` },
      { status: 429 }
    );
  }

  const { pin } = await request.json();
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "Введите ПИН-код" }, { status: 400 });
  }

  const operator = await findOperatorByPin(device.point.tenantId, pin);
  if (!operator) {
    await recordFailedDevicePin(device.id, device.failedPinAttempts);
    return NextResponse.json({ error: "Неверный ПИН-код" }, { status: 401 });
  }
  if (device.failedPinAttempts > 0) await resetDevicePinLockout(device.id);
  // ПИН верный, но Сотрудник деактивирован — отдельная причина, не "неверный
  // ПИН" (реальный баг, найден пользователем 2026-07-22, см. комментарий у
  // findOperatorByPin).
  if (!operator.active) {
    return NextResponse.json({ error: "Сотрудник деактивирован. Обратитесь к владельцу." }, { status: 403 });
  }

  await createOperatorSession(operator.id);

  // Whatever language the operator picked on the login screen (see
  // AuthLocalePicker) becomes their persisted personal preference — otherwise
  // it silently reverted to the tenant's language the instant they logged in
  // (found 2026-07-10, "у Оператора не переключается язык").
  const preAuthLocale = await getPreAuthLocaleCookie();
  if (preAuthLocale && preAuthLocale !== operator.locale) {
    await prisma.operator.update({ where: { id: operator.id }, data: { locale: preAuthLocale } });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: device.point.tenantId },
    select: { accentScheme: true },
  });
  if (tenant) {
    await setAccentCookie(tenant.accentScheme);
  }

  return NextResponse.json({ id: operator.id, name: operator.name });
}
