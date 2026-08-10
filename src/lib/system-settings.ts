import { prisma } from "@/lib/prisma";

// Платформенные секреты (docs/spec/06-super-admin.md, п.4) — единственная
// запись SystemSettings.id="singleton", редактируется в /admin/settings.
// До появления Админ-модуля эти значения жили в .env (SMTP_*/TELEGRAM_BOT_*) —
// теперь БД первична, .env остаётся тихим фоллбэком (чтобы окружения без
// заполненных настроек в БД не переставали работать молча).
export interface SystemSettingsConfig {
  telegramBotToken: string;
  // Не редактируется формой /admin/settings напрямую (нет такого поля) —
  // кэш username бота, получаемый через getMe по уже сохранённому токену
  // (см. src/lib/telegram-bot.ts getBotUsername). Раньше username брался
  // только из .env TELEGRAM_BOT_USERNAME, который никогда не заполнялся на
  // проде (для него нет формы, в отличие от токена) — из-за этого
  // getBindDeepLink() молча возвращал null, а ссылка "Открыть Telegram" в
  // визарде привязки вообще не рендерилась (нашли 2026-07-11).
  telegramBotUsername: string;
  // from — реальный email (обязан совпадать с authenticated SMTP user для
  // SPF/DKIM-выравнивания, см. src/lib/summary-channels/email-channel.ts);
  // fromName — отображаемое имя отправителя, не влияет на прохождение
  // проверок, чисто косметическое поле "От кого" в письме.
  smtp: { host: string; port: string; user: string; password: string; from: string; fromName: string };
  // VAPID-пара для Web Push (фидбек пользователя 2026-07-12: "сделай
  // настройки для Админа для Push уведомлений") — та же логика "БД
  // первична, .env фоллбэк", что и у остальных секретов здесь. Ключ
  // генерируется кнопкой в /admin/settings (POST .../generate-vapid-keys),
  // а не вручную — это ECDSA-пара, а не пароль, который можно придумать.
  vapid: { publicKey: string; privateKey: string; subject: string };
  // Группа Super Admin'а в Telegram (запрос пользователя 2026-08-10) —
  // уведомления о жизни платформы: новый Владелец, оплата, удаление кабинета.
  // Шлёт тот же единый бот, что и всем остальным, поэтому здесь только chatId
  // и тумблеры, токен один на всё и лежит выше.
  //
  // Тикетов в этом списке нет намеренно: они живут в Fluent Support на сайте,
  // у него своя штатная интеграция с Telegram — ей отдаются тот же токен и
  // тот же chatId, а не дублируется наш код.
  adminNotifications: {
    chatId: string;
    chatTitle: string;
    newOwner: boolean;
    payment: boolean;
    deletion: boolean;
  };
}

const EMPTY: SystemSettingsConfig = {
  telegramBotToken: "",
  telegramBotUsername: "",
  smtp: { host: "", port: "", user: "", password: "", from: "", fromName: "" },
  vapid: { publicKey: "", privateKey: "", subject: "" },
  // Тумблеры включены заранее: группу подключают ровно затем, чтобы получать
  // эти уведомления, — заставлять после привязки включать их по одному значило
  // бы, что первое время группа молчит без видимой причины.
  adminNotifications: { chatId: "", chatTitle: "", newOwner: true, payment: true, deletion: true },
};

export async function getSystemSettingsConfig(): Promise<SystemSettingsConfig> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  const config = (row?.config as Partial<SystemSettingsConfig> | undefined) ?? {};
  return {
    telegramBotToken: config.telegramBotToken || EMPTY.telegramBotToken,
    telegramBotUsername: config.telegramBotUsername || EMPTY.telegramBotUsername,
    smtp: { ...EMPTY.smtp, ...(config.smtp ?? {}) },
    vapid: { ...EMPTY.vapid, ...(config.vapid ?? {}) },
    adminNotifications: { ...EMPTY.adminNotifications, ...(config.adminNotifications ?? {}) },
  };
}

/** Точечное обновление одного поля без риска затереть остальные (см. telegramBotUsername выше). */
export async function patchSystemSettingsConfig(patch: Partial<SystemSettingsConfig>): Promise<void> {
  const current = await getSystemSettingsConfig();
  await saveSystemSettingsConfig({ ...current, ...patch });
}

export async function saveSystemSettingsConfig(next: SystemSettingsConfig): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", config: JSON.parse(JSON.stringify(next)) },
    update: { config: JSON.parse(JSON.stringify(next)) },
  });
}
