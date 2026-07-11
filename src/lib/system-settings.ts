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
}

const EMPTY: SystemSettingsConfig = {
  telegramBotToken: "",
  telegramBotUsername: "",
  smtp: { host: "", port: "", user: "", password: "", from: "", fromName: "" },
};

export async function getSystemSettingsConfig(): Promise<SystemSettingsConfig> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  const config = (row?.config as Partial<SystemSettingsConfig> | undefined) ?? {};
  return {
    telegramBotToken: config.telegramBotToken || EMPTY.telegramBotToken,
    telegramBotUsername: config.telegramBotUsername || EMPTY.telegramBotUsername,
    smtp: { ...EMPTY.smtp, ...(config.smtp ?? {}) },
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
