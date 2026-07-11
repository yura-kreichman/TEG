import { prisma } from "@/lib/prisma";

// Платформенные секреты (docs/spec/06-super-admin.md, п.4) — единственная
// запись SystemSettings.id="singleton", редактируется в /admin/settings.
// До появления Админ-модуля эти значения жили в .env (SMTP_*/TELEGRAM_BOT_*) —
// теперь БД первична, .env остаётся тихим фоллбэком (чтобы окружения без
// заполненных настроек в БД не переставали работать молча).
export interface SystemSettingsConfig {
  telegramBotToken: string;
  smtp: { host: string; port: string; user: string; password: string; from: string };
}

const EMPTY: SystemSettingsConfig = {
  telegramBotToken: "",
  smtp: { host: "", port: "", user: "", password: "", from: "" },
};

export async function getSystemSettingsConfig(): Promise<SystemSettingsConfig> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  const config = (row?.config as Partial<SystemSettingsConfig> | undefined) ?? {};
  return {
    telegramBotToken: config.telegramBotToken || EMPTY.telegramBotToken,
    smtp: { ...EMPTY.smtp, ...(config.smtp ?? {}) },
  };
}

export async function saveSystemSettingsConfig(next: SystemSettingsConfig): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", config: JSON.parse(JSON.stringify(next)) },
    update: { config: JSON.parse(JSON.stringify(next)) },
  });
}
