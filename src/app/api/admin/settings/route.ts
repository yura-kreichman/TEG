import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { getSystemSettingsConfig, saveSystemSettingsConfig, type SystemSettingsConfig } from "@/lib/system-settings";

// Глобальные настройки платформы (docs/spec/06-super-admin.md, п.4) —
// единственная запись SystemSettings.id="singleton".
// Дефолты локали/часового пояса/валюты для новых тенантов не нужны (фидбек
// пользователя 2026-07-12: "они сами себе их задают" — locale уже
// определяется при регистрации через resolveLocale(), timezone — по
// браузеру при регистрации, см. /api/auth/register).
//
// Секреты в браузер НЕ уезжают (аудит 2026-08-13). Раньше этот GET отдавал их
// открытым текстом с обоснованием «это единственное место, где ими управляют,
// скрывать от самого админа смысла нет» — по отдельности верно. Вместе с CSP,
// где в script-src стоит 'unsafe-inline', цена другая: один XSS в /admin
// выносит разом токен единого бота платформы (все Telegram-сводки и клиентские
// боты ВСЕХ тенантов), пароль SMTP (рассылка от имени домена, а значит и
// перехват писем со сбросом пароля) и приватный ключ VAPID. Для работы они
// админу и не нужны: новое значение задаётся, не видя старого, а проверка
// токена (test-telegram) берёт его из базы, не из формы.
export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const config = await getSystemSettingsConfig();
  return NextResponse.json({
    ...config,
    telegramBotToken: "",
    smtp: { ...config.smtp, password: "" },
    vapid: { ...config.vapid, privateKey: "" },
    // Пустое поле выглядит одинаково и когда секрет задан, и когда его нет —
    // эти флаги дают форме отличить одно от другого и не пугать админа
    // «ничего не настроено». Восстановить значения из них нельзя.
    secretsSet: {
      telegramBotToken: config.telegramBotToken.length > 0,
      smtpPassword: config.smtp.password.length > 0,
      vapidPrivateKey: config.vapid.privateKey.length > 0,
    },
  });
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

  // Секрет из формы приходит пустым, если админ его не трогал — GET их больше
  // не отдаёт (см. комментарий выше). Пустое значение здесь означает «оставить
  // как было», иначе обычное сохранение любой соседней настройки стирало бы
  // токен бота и пароль SMTP. Стереть секрет намеренно можно, прислав пробел:
  // trim делает его пустой строкой уже ПОСЛЕ этой проверки.
  const keepIfBlank = (incoming: unknown, existing: string): string =>
    typeof incoming === "string" && incoming !== "" ? incoming.trim() : existing;

  const next: SystemSettingsConfig = {
    telegramBotToken: keepIfBlank(body.telegramBotToken, current.telegramBotToken),
    // Нет поля в форме — всегда сохраняем как было (кэш, обновляется только
    // через getBotUsername()/test-telegram, см. system-settings.ts).
    telegramBotUsername: current.telegramBotUsername,
    smtp: {
      ...current.smtp,
      ...(typeof body.smtp === "object" && body.smtp !== null ? body.smtp : {}),
      password: keepIfBlank(body.smtp?.password, current.smtp.password),
    },
    vapid: {
      ...current.vapid,
      ...(typeof body.vapid === "object" && body.vapid !== null ? body.vapid : {}),
      privateKey: keepIfBlank(body.vapid?.privateKey, current.vapid.privateKey),
    },
    adminNotifications: {
      ...current.adminNotifications,
      // Только тумблеры: chatId/chatTitle форма не редактирует, их пишет
      // привязка через бота (и стирает кнопка "Отвязать").
      ...(typeof body.adminNotifications === "object" && body.adminNotifications !== null
        ? {
            newOwner: Boolean(body.adminNotifications.newOwner),
            payment: Boolean(body.adminNotifications.payment),
            deletion: Boolean(body.adminNotifications.deletion),
          }
        : {}),
    },
  };

  await saveSystemSettingsConfig(next);
  return NextResponse.json({ ok: true });
}
