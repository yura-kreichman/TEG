import nodemailer from "nodemailer";
import type { ChannelSendResult } from "./types";
import { getSystemSettingsConfig } from "@/lib/system-settings";

// SMTP — платформенная настройка (docs/spec/06-super-admin.md, "Настройки" →
// /admin/settings), не тенантная. БД (SystemSettings) первична; .env
// (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM) остаётся тихим
// фоллбэком для окружений, где ещё ничего не заполнено в /admin/settings —
// раньше это было единственным источником, до появления реального Админ-модуля.
async function getConfig() {
  const { smtp } = await getSystemSettingsConfig();
  const host = smtp.host || process.env.SMTP_HOST;
  const port = smtp.port || process.env.SMTP_PORT;
  const user = smtp.user || process.env.SMTP_USER;
  const pass = smtp.password || process.env.SMTP_PASS;
  const from = smtp.from || process.env.SMTP_FROM || user;
  if (!host || !port || !user || !pass || !from) return null;
  // Формат '"Имя" <email>' — nodemailer сам берёт email-часть для envelope
  // (SPF/DKIM проверяются по нему, не по отображаемому имени), в заголовке
  // получателю показывается имя. fromName опционален — без него просто email.
  const fromHeader = smtp.fromName ? `"${smtp.fromName.replace(/"/g, "")}" <${from}>` : from;
  return { host, port: Number(port), user, pass, from: fromHeader };
}

export async function isEmailConfigured(): Promise<boolean> {
  return (await getConfig()) !== null;
}

// Кэш транспорта — по строке подключения, а не глобально одним значением:
// настройки теперь могут поменяться в рантайме через /admin/settings без
// рестарта процесса, старый закешированный транспорт на прежний хост иначе
// продолжал бы использоваться до следующего деплоя.
let cachedKey: string | null = null;
let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
async function getTransport(config: NonNullable<Awaited<ReturnType<typeof getConfig>>>) {
  const key = `${config.host}:${config.port}:${config.user}`;
  if (!cachedTransport || cachedKey !== key) {
    cachedTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
    cachedKey = key;
  }
  return cachedTransport;
}

export async function sendEmail(
  addresses: string[],
  subject: string,
  html: string
): Promise<ChannelSendResult> {
  const config = await getConfig();
  if (!config) return { ok: false, error: "SMTP не настроен" };
  if (addresses.length === 0) return { ok: false, error: "Нет адресов" };

  const transport = await getTransport(config);
  try {
    await transport.sendMail({ from: config.from, to: addresses.join(", "), subject, html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Не удалось отправить письмо" };
  }
}

export function parseEmailAddresses(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
