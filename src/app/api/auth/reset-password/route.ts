import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword, hashResetToken, rememberOwnerDevice } from "@/lib/auth";
import { setAccentCookie } from "@/lib/accent";
import { setThemeModeCookie } from "@/lib/theme-mode";

export async function POST(request: Request) {
  const { token, password } = await request.json();

  if (typeof token !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "token и password обязательны" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Пароль должен быть не короче 8 символов" },
      { status: 400 }
    );
  }

  const tokenHash = hashResetToken(token);
  const user = await prisma.user.findUnique({ where: { resetTokenHash: tokenHash } });

  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    return NextResponse.json(
      { error: "Ссылка для сброса пароля недействительна или устарела" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      // Force the PIN to be set again after a password reset, since a reset can mean
      // the account's previous credentials may have been compromised.
      pinHash: null,
      failedPinAttempts: 0,
      pinLockedUntil: null,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    },
  });

  await createSession(user.id);
  await rememberOwnerDevice(user.id);
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { accentScheme: true, themeMode: true },
    });
    if (tenant) {
      await setAccentCookie(tenant.accentScheme);
      await setThemeModeCookie(tenant.themeMode);
    }
  }

  return NextResponse.json({ id: user.id, email: user.email });
}
