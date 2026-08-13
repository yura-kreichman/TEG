import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword, hashResetToken, rememberOwnerDevice } from "@/lib/auth";
import { setAccentCookie } from "@/lib/accent";
import { setBgStyleCookie } from "@/lib/bg-style";

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

export async function POST(request: Request) {
  const { token, password, timezone } = await request.json();

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
      // Свежий пароль — снимаем и его блокировку тоже (аудит 2026-07-27,
      // второй раунд), тот же принцип, что уже применён к ПИНу выше.
      failedPasswordAttempts: 0,
      failedPasswordFirstAt: null,
      passwordLockedUntil: null,
      // Все ранее выданные сессии этого пользователя перестают приниматься
      // (аудит 2026-08-13). Сброс пароля — ровно тот случай, ради которого
      // отзыв и заводился: до этого человек, у которого увели куку, менял
      // пароль и оставался с работающей чужой сессией. См.
      // lib/session-revocation.ts — там же про порядок: отзыв ДО createSession,
      // иначе новая сессия обесценит сама себя.
      sessionsValidFrom: new Date(),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    },
  });

  await createSession(user.id);
  await rememberOwnerDevice(user.id);
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { accentScheme: true, bgStyle: true, timezone: true },
    });
    // Пояс подставляем ТОЛЬКО пока он схемный "UTC" — то есть его никто не
    // выбирал. Так закрывается кабинет, созданный по факту покупки (там
    // браузера не было, см. lib/fluentcart-provision.ts), и не затирается
    // осознанно выставленный пояс у того, кто просто сбрасывает пароль,
    // находясь в отпуске в другом часовом поясе.
    if (
      tenant?.timezone === "UTC" &&
      typeof timezone === "string" &&
      timezone !== "UTC" &&
      VALID_TIMEZONES.has(timezone)
    ) {
      await prisma.tenant.update({ where: { id: user.tenantId }, data: { timezone } });
    }
    if (tenant) {
      await setAccentCookie(tenant.accentScheme);
      await setBgStyleCookie(tenant.bgStyle);
    }
  }

  return NextResponse.json({ id: user.id, email: user.email });
}
