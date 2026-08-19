import { NextResponse } from "next/server";
import {
  createOperatorSession,
  findOperatorByPin,
  getActivatedDevice,
} from "@/lib/operator-auth";
import { setAccentCookie } from "@/lib/accent";
import { clearPreAuthLocaleCookie } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { isAuthRateLimited, PIN_ATTEMPTS_PER_WINDOW } from "@/lib/auth-rate-limit";
import {
  clearFailedPins,
  devicePinKey,
  pinBlockedForMinutes,
  recordFailedPin,
} from "@/lib/pin-attempts";
import { getClientIp } from "@/lib/instructions/request-ip";

export async function POST(request: Request) {
  // Верхний предел на весь адрес: у точки все планшеты часто выходят в сеть
  // через один IP, поэтому бюджет здесь щедрый (см. PIN_ATTEMPTS_PER_WINDOW) —
  // он ловит перебор с подменой устройства, а не сотрудника с опечаткой.
  if (isAuthRateLimited("operator-login", getClientIp(request), PIN_ATTEMPTS_PER_WINDOW)) {
    return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
  }

  const device = await getActivatedDevice();
  if (!device) {
    return NextResponse.json(
      { error: "Это устройство ещё не привязано к точке. Обратитесь к владельцу." },
      { status: 400 }
    );
  }

  // Предел неверных ПИНов на это устройство — окно, а не накопление за всё
  // время (см. lib/pin-attempts.ts, там же разобран случай Park от 8 августа).
  // Проверяем до сканирования операторов: заблокированному сравнивать незачем.
  const attemptsKey = devicePinKey(device.id);
  const blockedFor = pinBlockedForMinutes(attemptsKey);
  if (blockedFor !== null) {
    return NextResponse.json(
      { error: `Слишком много неверных ПИН-кодов. Попробуйте через ${blockedFor} мин.` },
      { status: 429 }
    );
  }

  const { pin } = await request.json();
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "Введите ПИН-код" }, { status: 400 });
  }

  const operator = await findOperatorByPin(device.point.tenantId, pin);
  if (!operator) {
    recordFailedPin(attemptsKey);
    return NextResponse.json({ error: "Неверный ПИН-код" }, { status: 401 });
  }
  clearFailedPins(attemptsKey);
  // ПИН верный, но Сотрудник деактивирован — отдельная причина, не "неверный
  // ПИН" (реальный баг, найден пользователем 2026-07-22, см. комментарий у
  // findOperatorByPin).
  if (!operator.active) {
    return NextResponse.json({ error: "Сотрудник деактивирован. Обратитесь к владельцу." }, { status: 403 });
  }

  await createOperatorSession(operator.id);

  // Язык сотрудника — только то, что задал Владелец в его карточке (по
  // умолчанию язык компании). Раньше сюда записывался выбор с экрана входа,
  // и это выходило боком: устройство точки общее, кука с выбором живёт год,
  // и один случайный тап по переключателю 17.08.2026 переучил на английский
  // и Женю, и Ивана — причём при каждом входе заново, отменяя правки
  // Владельца в карточке. Куку стираем, чтобы следующий человек увидел
  // экран входа на языке компании.
  await clearPreAuthLocaleCookie();

  const tenant = await prisma.tenant.findUnique({
    where: { id: device.point.tenantId },
    select: { accentScheme: true },
  });
  if (tenant) {
    await setAccentCookie(tenant.accentScheme);
  }

  return NextResponse.json({ id: operator.id, name: operator.name });
}
