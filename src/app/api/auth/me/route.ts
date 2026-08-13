import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isSessionRevoked } from "@/lib/session-revocation";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      role: true,
      tenantId: true,
      createdAt: true,
      pinHash: true,
      sessionsValidFrom: true,
    },
  });

  // Отзыв сессий (второй проход аудита 2026-08-13) — этот роут отдаёт кабинету
  // email и роль; после смены пароля старая сессия не должна их видеть.
  if (!user || isSessionRevoked(session, user.sessionsValidFrom)) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const { pinHash, sessionsValidFrom: _revokedAt, ...rest } = user;
  void _revokedAt;
  return NextResponse.json({ user: { ...rest, hasPin: Boolean(pinHash) } });
}
