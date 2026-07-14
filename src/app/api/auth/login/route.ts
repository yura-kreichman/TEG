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

async function syncAccentCookie(tenantId: string | null) {
  if (!tenantId) return;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accentScheme: true },
  });
  if (tenant) {
    await setAccentCookie(tenant.accentScheme);
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

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

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
