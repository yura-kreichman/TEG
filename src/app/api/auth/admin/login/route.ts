import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminSession, verifyPassword } from "@/lib/auth";

// Отдельный вход для платформенного Super Admin (docs/spec/00-architecture.md) —
// намеренно не переиспользует /api/auth/login: не хотим, чтобы одна форма
// проверяла учётки и владельцев, и админов платформы.
export async function POST(request: Request) {
  const { email, password } = await request.json();

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "email и password обязательны" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  await createAdminSession(user.id);
  return NextResponse.json({ id: user.id, email: user.email });
}
