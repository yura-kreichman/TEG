import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  PIN_LOCK_DURATION_MS,
  PIN_LOCK_THRESHOLD,
  createSession,
  getOwnerDeviceUserId,
  forgetOwnerDevice,
  rememberOwnerDevice,
  verifyPassword,
  verifyPin,
} from "@/lib/auth";
import { setAccentCookie } from "@/lib/accent";
import { setThemeModeCookie } from "@/lib/theme-mode";

async function syncAccentCookie(tenantId: string | null) {
  if (!tenantId) return;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accentScheme: true, themeMode: true },
  });
  if (tenant) {
    await setAccentCookie(tenant.accentScheme);
    await setThemeModeCookie(tenant.themeMode);
  }
}

const DEVICE_NOT_RECOGNIZED =
  "Это устройство ещё не привязано к аккаунту. Войдите с логином и паролем.";

export async function POST(request: Request) {
  const { email, password, pin } = await request.json();

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

    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      return NextResponse.json(
        {
          error:
            "Слишком много неверных попыток ввода ПИН-кода. Попробуйте позже или войдите с логином и паролем.",
        },
        { status: 429 }
      );
    }

    const ok = await verifyPin(pin, user.pinHash);
    if (!ok) {
      const failedPinAttempts = user.failedPinAttempts + 1;
      const locked = failedPinAttempts >= PIN_LOCK_THRESHOLD;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedPinAttempts,
          pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCK_DURATION_MS) : null,
        },
      });
      return NextResponse.json(
        {
          error: locked
            ? "Слишком много неверных попыток. ПИН-код временно заблокирован, войдите с логином и паролем."
            : "Неверный ПИН-код",
        },
        { status: 401 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedPinAttempts: 0, pinLockedUntil: null },
    });
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

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedPinAttempts: 0, pinLockedUntil: null },
  });
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
