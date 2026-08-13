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
  clearFailedLoginAttempts,
  equalizePasswordTiming,
  isLockedOut,
  loginAttemptKey,
  loginBlockedForMinutes,
  recordFailedLoginAttempt,
  remainingLockoutMinutes,
  recordFailedPassword,
  resetPasswordLockout,
} from "@/lib/login-lockout";
import { findUserByEmail } from "@/lib/normalize-email";
import { isAuthRateLimited, PIN_ATTEMPTS_PER_WINDOW } from "@/lib/auth-rate-limit";
import {
  clearFailedPins,
  pinBlockedForMinutes,
  recordFailedPin,
  userPinKey,
} from "@/lib/pin-attempts";
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
  // Битое тело — это 400 по ветке пароля ниже, а не исключение: разбор стоит
  // раньше лимита, и падение здесь означало бы 500 в обход ограничителя.
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const { email, password, pin } = (payload ?? {}) as {
    email?: unknown;
    password?: unknown;
    pin?: unknown;
  };

  // Бюджеты у вкладок разные, поэтому лимит считаем после разбора тела. Раньше
  // он был общий на весь роут (аудит 2026-07-24) — при блокировке аккаунта это
  // было верно, обе вкладки ведут в один аккаунт. Теперь у ПИНа свой предел
  // неверных попыток (окно, lib/pin-attempts.ts), а этот лимит для него —
  // внешняя граница, и достижимой человеком она быть не должна: держать её
  // наравне с паролем значило бы вернуть ту же блокировку другими словами.
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

    // Предел неверных ПИНов — окно, а не накопление за всё время (см.
    // lib/pin-attempts.ts). У владельца точка входа — сам аккаунт: ПИН
    // проверяется только против него, устройство уже опознано кукой.
    const attemptsKey = userPinKey(user.id);
    const blockedFor = pinBlockedForMinutes(attemptsKey);
    if (blockedFor !== null) {
      return NextResponse.json(
        {
          error: `Слишком много неверных ПИН-кодов. Попробуйте через ${blockedFor} мин или войдите с логином и паролем.`,
        },
        { status: 429 }
      );
    }

    const ok = await verifyPin(pin, user.pinHash);
    if (!ok) {
      recordFailedPin(attemptsKey);
      return NextResponse.json({ error: "Неверный ПИН-код" }, { status: 401 });
    }
    clearFailedPins(attemptsKey);

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

  // Предел по паре (введённый email + IP) — ПЕРВЫМ, до похода в базу за
  // пользователем (аудит 2026-08-13). Порядок здесь и есть суть правки:
  // считается ЛЮБОЙ введённый адрес, существующий или нет, поэтому 429
  // приходит одинаково в обоих случаях и по ответу больше нельзя понять,
  // заведён ли аккаунт. Раньше блокировка жила на найденном пользователе, и
  // сам факт 429 означал «такой email есть». Почему предел теперь не на
  // аккаунт целиком (им можно было запереть владельца снаружи) — в
  // lib/login-lockout.ts.
  const attemptKey = loginAttemptKey(email, ip);
  const blockedFor = loginBlockedForMinutes(attemptKey);
  if (blockedFor !== null) {
    return NextResponse.json(
      { error: `Слишком много попыток. Попробуйте через ${blockedFor} мин.` },
      { status: 429 }
    );
  }

  const user = await findUserByEmail(email);
  if (!user) {
    // Проверка-пустышка той же стоимости, что настоящая (аудит 2026-08-13):
    // без неё «такого email нет» отвечало мгновенно, а «email есть, пароль
    // неверный» — через ~285 мс bcrypt'а, и эта разница измеряется по сети
    // надёжно. Одинаковый текст ответа сам по себе ничего не скрывал.
    await equalizePasswordTiming(password);
    recordFailedLoginAttempt(attemptKey);
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  // Второй уровень — блокировка аккаунта целиком (аудит 2026-07-27; порог
  // поднят и добавлено окно 2026-08-13): страховка от распределённого
  // перебора с многих адресов, до которой человек с опечатками не доходит.
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
