import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminSession, verifyPassword } from "@/lib/auth";
import { isAuthRateLimited } from "@/lib/auth-rate-limit";
import {
  clearFailedLoginAttempts,
  equalizePasswordTiming,
  isLockedOut,
  loginAttemptKey,
  loginBlockedForMinutes,
  recordFailedLoginAttempt,
  recordFailedPassword,
  remainingLockoutMinutes,
  resetPasswordLockout,
} from "@/lib/login-lockout";
import { getClientIp } from "@/lib/instructions/request-ip";

// Отдельный вход для платформенного Super Admin (docs/spec/06-super-admin.md) —
// намеренно не переиспользует /api/auth/login: не хотим, чтобы одна форма
// проверяла учётки и владельцев, и админов платформы. Вход по логину, не
// email (п.1 спеки) — аккаунт заводится/чинится через npm run admin:seed.
export async function POST(request: Request) {
  // Самый чувствительный вход в проекте (полный доступ ко всем тенантам) —
  // отдельный, независимый лимит от /api/auth/login (аудит 2026-07-24).
  if (isAuthRateLimited("admin-login", getClientIp(request))) {
    return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
  }

  const { login, password } = await request.json();

  if (typeof login !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "login и password обязательны" }, { status: 400 });
  }

  // Предел по паре (введённый логин + IP) — до похода в базу, тем же
  // порядком и по той же причине, что в /api/auth/login (аудит 2026-08-13):
  // считается любой введённый логин, поэтому 429 не выдаёт существование
  // аккаунта, а заблокировать самого админа снаружи, зная его логин, больше
  // нельзя. См. lib/login-lockout.ts.
  const attemptKey = loginAttemptKey(login, getClientIp(request));
  const blockedFor = loginBlockedForMinutes(attemptKey);
  if (blockedFor !== null) {
    return NextResponse.json(
      { error: `Слишком много попыток. Попробуйте через ${blockedFor} мин.` },
      { status: 429 }
    );
  }

  const user = await prisma.user.findUnique({ where: { login } });
  if (!user || user.role !== "super_admin") {
    // Пустышка той же стоимости — иначе несуществующий логин отвечал
    // мгновенно, а существующий через ~285 мс bcrypt'а.
    await equalizePasswordTiming(password);
    recordFailedLoginAttempt(attemptKey);
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  // Второй уровень — блокировка аккаунта целиком (аудит 2026-07-27, порог и
  // окно пересмотрены 2026-08-13): самый чувствительный вход в проекте, тем
  // более нуждается в страховке от распределённого перебора.
  if (isLockedOut(user.passwordLockedUntil)) {
    return NextResponse.json(
      { error: `Слишком много попыток. Попробуйте через ${remainingLockoutMinutes(user.passwordLockedUntil!)} мин.` },
      { status: 429 }
    );
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    recordFailedLoginAttempt(attemptKey);
    await recordFailedPassword(user.id);
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }
  clearFailedLoginAttempts(attemptKey);
  if (user.failedPasswordAttempts > 0) await resetPasswordLockout(user.id);

  await createAdminSession(user.id);
  return NextResponse.json({ id: user.id, login: user.login });
}
