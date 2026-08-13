import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { hashPassword, verifyPassword } from "@/lib/auth";

// Смена логина/пароля Super Admin из /admin/settings (по запросу
// пользователя 2026-07-11 — раньше это делалось только через
// admin:seed/admin:reset-password скрипты, см. scripts/). Требует
// currentPassword независимо от того, что именно меняется — это смена
// собственных учётных данных, не то же самое, что редактирование чужого
// объекта.
export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }
  return NextResponse.json({ login: admin.user.login });
}

export async function PATCH(request: Request) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const body = await request.json();
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const { currentPassword, newLogin, newPassword } = body as {
    currentPassword?: unknown;
    newLogin?: unknown;
    newPassword?: unknown;
  };

  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json({ error: "Введите текущий пароль" }, { status: 400 });
  }
  if (!(await verifyPassword(currentPassword, admin.user.passwordHash))) {
    return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 400 });
  }

  const data: { login?: string; passwordHash?: string; sessionsValidFrom?: Date } = {};

  if (typeof newLogin === "string" && newLogin.trim() && newLogin.trim() !== admin.user.login) {
    data.login = newLogin.trim();
  }

  if (typeof newPassword === "string" && newPassword) {
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Новый пароль должен быть не короче 8 символов" }, { status: 400 });
    }
    data.passwordHash = await hashPassword(newPassword);
    // Смена пароля обесценивает все ранее выданные сессии платформенной
    // панели (аудит 2026-08-13) — включая текущую, поэтому админ после
    // сохранения войдёт заново. Это и есть ожидаемое поведение: пароль тут
    // меняют, когда подозревают, что доступ увели. См. lib/session-revocation.ts.
    data.sessionsValidFrom = new Date();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего сохранять" }, { status: 400 });
  }

  try {
    await prisma.user.update({ where: { id: admin.user.id }, data });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Такой логин уже занят" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, login: data.login ?? admin.user.login });
}
