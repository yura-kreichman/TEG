import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RESET_TOKEN_TTL_MS, generateResetToken } from "@/lib/auth";

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

  const resetLink = `${new URL(request.url).origin}/reset-password?token=${token}`;

  if (process.env.NODE_ENV === "production") {
    // TODO: wire up a real email provider (SMTP/Resend/etc.) once the app is deployed
    // to production hosting. Until then, resets are silently unusable in production —
    // deliberately not logging the live reset link/token: server logs are a wider trust
    // boundary than the DB, and a logged link is a working account-takeover token.
    return NextResponse.json({ message: GENERIC_MESSAGE });
  }

  // In development there's no email provider wired up, so we hand the link straight
  // back to the caller to make the flow testable end-to-end.
  return NextResponse.json({ message: GENERIC_MESSAGE, devResetLink: resetLink });
}
