import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { getSystemSettingsConfig, patchSystemSettingsConfig } from "@/lib/system-settings";

// Проверка токена бота (docs/spec/06-super-admin.md, /admin/settings) —
// getMe ничего не отправляет, просто подтверждает, что токен рабочий, и
// возвращает username бота для наглядности.
export async function POST() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { telegramBotToken } = await getSystemSettingsConfig();
  const token = telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Токен бота не задан" }, { status: 503 });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    return NextResponse.json({ error: data?.description ?? "Токен не работает" }, { status: 400 });
  }

  // Держим кэш username свежим (см. src/lib/telegram-bot.ts getBotUsername) —
  // на случай если токен когда-нибудь сменят на другого бота.
  await patchSystemSettingsConfig({ telegramBotUsername: data.result.username });

  return NextResponse.json({ ok: true, username: data.result.username });
}
