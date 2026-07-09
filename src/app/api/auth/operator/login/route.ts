import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PIN_LOCK_DURATION_MS, PIN_LOCK_THRESHOLD } from "@/lib/auth";
import {
  createOperatorSession,
  findOperatorByPin,
  getActivatedDevice,
} from "@/lib/operator-auth";
import { setAccentCookie } from "@/lib/accent";
import { getPreAuthLocaleCookie } from "@/lib/i18n";

export async function POST(request: Request) {
  const device = await getActivatedDevice();
  if (!device) {
    return NextResponse.json(
      { error: "Это устройство ещё не привязано к точке. Обратитесь к владельцу." },
      { status: 400 }
    );
  }

  if (device.pinLockedUntil && device.pinLockedUntil > new Date()) {
    return NextResponse.json(
      { error: "Слишком много неверных попыток. Попробуйте позже." },
      { status: 429 }
    );
  }

  const { pin } = await request.json();
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "Введите ПИН-код" }, { status: 400 });
  }

  const operator = await findOperatorByPin(device.point.tenantId, pin);
  if (!operator) {
    const failedPinAttempts = device.failedPinAttempts + 1;
    const locked = failedPinAttempts >= PIN_LOCK_THRESHOLD;
    await prisma.pointDevice.update({
      where: { id: device.id },
      data: {
        failedPinAttempts,
        pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCK_DURATION_MS) : null,
      },
    });
    return NextResponse.json(
      {
        error: locked
          ? "Слишком много неверных попыток. Устройство временно заблокировано."
          : "Неверный ПИН-код",
      },
      { status: locked ? 429 : 401 }
    );
  }

  await prisma.pointDevice.update({
    where: { id: device.id },
    data: { failedPinAttempts: 0, pinLockedUntil: null },
  });
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
