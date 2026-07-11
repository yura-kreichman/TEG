import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RESET_TOKEN_TTL_MS, generateResetToken } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/request-origin";
import { isEmailConfigured, sendEmail } from "@/lib/summary-channels/email-channel";

const GENERIC_MESSAGE =
  "Если такой email зарегистрирован, на него отправлена ссылка для сброса пароля.";

export async function POST(request: Request) {
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
    const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#F6F7F5;font-family:system-ui,sans-serif;color:#1B1F1D;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:24px;">
    <p style="font-size:14px;margin:0 0 16px;">Восстановление пароля RentOS.</p>
    <p style="margin:0 0 16px;">
      <a href="${resetLink}" style="display:inline-block;background:#1B7A5C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;">Сбросить пароль</a>
    </p>
    <p style="font-size:12px;color:#6B7268;margin:0;">Ссылка действует 1 час. Если вы не запрашивали сброс — проигнорируйте это письмо.</p>
  </div>
</body>
</html>`;
    // Best-effort: не блокируем и не палим в ответе результат отправки — тот же
    // generic-message инвариант, что и для "email не найден" выше, иначе можно
    // было бы понять по разнице в ответе, существует аккаунт или нет.
    await sendEmail([user.email], "RentOS — сброс пароля", html);
  }

  // devResetLink остаётся только когда SMTP не настроен вовсе (dev без /admin/settings) —
  // иначе локальную разработку было бы невозможно тестировать end-to-end.
  return NextResponse.json({
    message: GENERIC_MESSAGE,
    ...(emailConfigured ? {} : { devResetLink: resetLink }),
  });
}
