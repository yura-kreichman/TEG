import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RESET_TOKEN_TTL_MS, generateResetToken } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/request-origin";
import { isEmailConfigured, sendEmail } from "@/lib/summary-channels/email-channel";
import { dictionaryForUser, renderAuthEmail } from "@/lib/auth-email";
import { isAuthRateLimited } from "@/lib/auth-rate-limit";
import { getClientIp } from "@/lib/instructions/request-ip";

const GENERIC_MESSAGE =
  "Если такой email зарегистрирован, на него отправлена ссылка для сброса пароля.";

export async function POST(request: Request) {
  // Без лимита это ещё и открытая рассылка спама на чужой email/SMTP-квота,
  // не только перебор (аудит 2026-07-24) — тот же generic-ответ ниже уже не
  // палит, существует ли аккаунт, но не мешает слать письма пачками.
  if (isAuthRateLimited("forgot-password", getClientIp(request))) {
    return NextResponse.json({ message: GENERIC_MESSAGE });
  }

  const { email } = await request.json();
  if (typeof email !== "string") {
    return NextResponse.json({ error: "email обязателен" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always respond the same way whether or not the account exists, to avoid leaking
  // which emails are registered.
  if (!user) {
    return NextResponse.json({ message: GENERIC_MESSAGE });
  }

  const { token, tokenHash } = generateResetToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const resetLink = `${getRequestOrigin(request)}/reset-password?token=${token}`;
  const emailConfigured = await isEmailConfigured();

  if (emailConfigured) {
    // Язык владельца, а не русский для всех (2026-08-08): письмо было
    // единственным местом auth-контура с захардкоженным текстом, и
    // англоязычный владелец получал сброс пароля по-русски.
    const t = await dictionaryForUser(user.id);
    const html = renderAuthEmail({
      lines: [t.authEmail.resetIntro],
      buttonLabel: t.authEmail.resetButton,
      link: resetLink,
      note: t.authEmail.resetNote,
    });
    // Best-effort: не блокируем и не палим в ответе результат отправки — тот же
    // generic-message инвариант, что и для "email не найден" выше, иначе можно
    // было бы понять по разнице в ответе, существует аккаунт или нет.
    await sendEmail([user.email], t.authEmail.resetSubject, html);
  }

  // devResetLink остаётся только когда SMTP не настроен вовсе (dev без /admin/settings) —
  // иначе локальную разработку было бы невозможно тестировать end-to-end.
  return NextResponse.json({
    message: GENERIC_MESSAGE,
    ...(emailConfigured ? {} : { devResetLink: resetLink }),
  });
}
