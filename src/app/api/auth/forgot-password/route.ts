import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RESET_TOKEN_TTL_MS, generateResetToken } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/request-origin";
import { isEmailConfigured, sendEmail } from "@/lib/summary-channels/email-channel";
import { dictionaryForUser, renderAuthEmail } from "@/lib/auth-email";
import { isAuthRateLimited } from "@/lib/auth-rate-limit";
import { getClientIp } from "@/lib/instructions/request-ip";
import { findUserByEmail } from "@/lib/normalize-email";

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

  // Без учёта регистра (аудит 2026-08-13) — владелец, набравший свой адрес с
  // заглавной (телефон подставляет её сам), получал общий ответ «если такой
  // email зарегистрирован…» и не получал письма вообще. См. normalize-email.ts.
  const user = await findUserByEmail(email);

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

  // devResetLink — ТОЛЬКО вне прода (аудит 2026-08-13, самая серьёзная находка).
  // Раньше условием было "SMTP не настроен", и это не dev-признак, а РАНТАЙМНАЯ
  // настройка из БД (/admin/settings): стоило её очистить, сменить почтовый хост
  // и не сохранить сразу, или потерять строку SystemSettings — и этот роут начинал
  // отдавать рабочий токен сброса пароля любому анонимному запросу по чужому email.
  // То есть захват аккаунта любого владельца, а для Super Admin — всей платформы,
  // одним POST. Между "работает почта" и "дыра открыта" стоял один тумблер в
  // админке. NODE_ENV сборкой зафиксирован в образе (Dockerfile: ENV NODE_ENV=
  // production) и из интерфейса не меняется — именно это здесь и нужно.
  // Условие isEmailConfigured остаётся вторым множителем: в dev без SMTP ссылка
  // по-прежнему приходит в ответе, иначе локально сброс не протестировать.
  const isProduction = process.env.NODE_ENV === "production";
  return NextResponse.json({
    message: GENERIC_MESSAGE,
    ...(isProduction || emailConfigured ? {} : { devResetLink: resetLink }),
  });
}
