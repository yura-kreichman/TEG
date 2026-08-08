import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSession,
  getOwnerDeviceUserId,
  forgetOwnerDevice,
  rememberOwnerDevice,
  verifyPassword,
  verifyPin,
} from "@/lib/auth";
import { setAccentCookie } from "@/lib/accent";
import { setBgStyleCookie } from "@/lib/bg-style";
import {
  isLockedOut,
  remainingLockoutMinutes,
  recordFailedPassword,
  resetPasswordLockout,
} from "@/lib/login-lockout";
import { isAuthRateLimited, PIN_ATTEMPTS_PER_WINDOW } from "@/lib/auth-rate-limit";
import { getClientIp } from "@/lib/instructions/request-ip";

async function syncAccentCookie(tenantId: string | null) {
  if (!tenantId) return;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accentScheme: true, bgStyle: true },
  });
  if (tenant) {
    await setAccentCookie(tenant.accentScheme);
    await setBgStyleCookie(tenant.bgStyle);
  }
}

const DEVICE_NOT_RECOGNIZED =
  "Это устройство ещё не привязано к аккаунту. Войдите с логином и паролем.";

export async function POST(request: Request) {
  const { email, password, pin } = await request.json();

  // Бюджеты у вкладок разные, поэтому лимит считаем после разбора тела. Раньше
  // он был общий на весь роут (аудит 2026-07-24) — при блокировке аккаунта это
  // было верно, обе вкладки ведут в один аккаунт. Теперь у ПИНа блокировки нет
  // и лимит для него единственная защита, но и достижим человеком он быть не
  // должен: держать его наравне с паролем значило бы вернуть ту же блокировку
  // другими словами.
  const ip = getClientIp(request);
  const purpose = typeof pin === "string" ? "owner-pin" : "owner-login";
  const budget = typeof pin === "string" ? PIN_ATTEMPTS_PER_WINDOW : undefined;
  if (isAuthRateLimited(purpose, ip, budget)) {
    return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
  }

  // PIN tab: no email — the account is resolved from this browser's owner_device cookie.
  if (typeof pin === "string") {
    const deviceUserId = await getOwnerDeviceUserId();
    if (!deviceUserId) {
      return NextResponse.json({ error: DEVICE_NOT_RECOGNIZED }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: deviceUserId } });
    if (!user) {
      await forgetOwnerDevice();
      return NextResponse.json({ error: DEVICE_NOT_RECOGNIZED }, { status: 400 });
    }

    if (!user.pinHash) {
      return NextResponse.json(
        { error: "ПИН-код ещё не установлен. Войдите с логином и паролем." },
        { status: 400 }
      );
    }

    // Неверный ПИН ничего не блокирует — ни счётчика попыток, ни временной
    // блокировки аккаунта (решение владельца 2026-08-08, см. login-lockout.ts).
    const ok = await verifyPin(pin, user.pinHash);
    if (!ok) {
      return NextResponse.json({ error: "Неверный ПИН-код" }, { status: 401 });
    }

    await createSession(user.id);
    await rememberOwnerDevice(user.id);
    await syncAccentCookie(user.tenantId);
    return NextResponse.json({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      hasPin: true,
    });
  }

  // Login and password tab.
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "email и password обязательны" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  // Блокировка по попыткам пароля (аудит 2026-07-27, второй раунд) — см.
  // lib/login-lockout.ts, почему у пароля она есть, а у ПИНа нет.
  if (isLockedOut(user.passwordLockedUntil)) {
    return NextResponse.json(
      { error: `Слишком много попыток. Попробуйте через ${remainingLockoutMinutes(user.passwordLockedUntil!)} мин.` },
      { status: 429 }
    );
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await recordFailedPassword(user.id);
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }
  if (user.failedPasswordAttempts > 0) await resetPasswordLockout(user.id);

  await createSession(user.id);
  await rememberOwnerDevice(user.id);
  await syncAccentCookie(user.tenantId);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    hasPin: Boolean(user.pinHash),
  });
}
