import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminSession, verifyPassword } from "@/lib/auth";

// Отдельный вход для платформенного Super Admin (docs/spec/06-super-admin.md) —
// намеренно не переиспользует /api/auth/login: не хотим, чтобы одна форма
// проверяла учётки и владельцев, и админов платформы. Вход по логину, не
// email (п.1 спеки) — аккаунт заводится/чинится через npm run admin:seed.
export async function POST(request: Request) {
  const { login, password } = await request.json();

  if (typeof login !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "login и password обязательны" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { login } });
  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 });
  }

  await createAdminSession(user.id);
  return NextResponse.json({ id: user.id, login: user.login });
}
