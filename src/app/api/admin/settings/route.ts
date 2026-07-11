import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { getSystemSettingsConfig, saveSystemSettingsConfig, type SystemSettingsConfig } from "@/lib/system-settings";

// Глобальные настройки платформы (docs/spec/06-super-admin.md, п.4) —
// единственная запись SystemSettings.id="singleton". Пароль SMTP отдаётся
// клиенту как есть (не read-only-маска) — это единственное место, где им
// вообще можно управлять, скрывать его от самого админа смысла не имеет.
// Дефолты локали/часового пояса/валюты для новых тенантов не нужны (фидбек
// пользователя 2026-07-12: "они сами себе их задают" — locale уже
// определяется при регистрации через resolveLocale(), timezone — по
// браузеру при регистрации, см. /api/auth/register).
export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  return NextResponse.json(await getSystemSettingsConfig());
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

  const current = await getSystemSettingsConfig();
  const next: SystemSettingsConfig = {
    telegramBotToken: typeof body.telegramBotToken === "string" ? body.telegramBotToken : current.telegramBotToken,
    smtp: {
      ...current.smtp,
      ...(typeof body.smtp === "object" && body.smtp !== null ? body.smtp : {}),
    },
  };

  await saveSystemSettingsConfig(next);
  return NextResponse.json({ ok: true });
}
