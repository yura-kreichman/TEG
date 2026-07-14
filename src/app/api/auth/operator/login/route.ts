import { NextResponse } from "next/server";
import {
  createOperatorSession,
  findOperatorByPin,
  getActivatedDevice,
} from "@/lib/operator-auth";
import { setAccentCookie } from "@/lib/accent";
import { getPreAuthLocaleCookie } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const device = await getActivatedDevice();
  if (!device) {
    return NextResponse.json(
      { error: "Это устройство ещё не привязано к точке. Обратитесь к владельцу." },
      { status: 400 }
    );
  }

  const { pin } = await request.json();
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "Введите ПИН-код" }, { status: 400 });
  }

  const operator = await findOperatorByPin(device.point.tenantId, pin);
  if (!operator) {
    return NextResponse.json({ error: "Неверный ПИН-код" }, { status: 401 });
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
