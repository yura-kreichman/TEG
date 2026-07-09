import nodemailer from "nodemailer";
import type { ChannelSendResult } from "./types";

// Обычный SMTP (пользователь подтвердил — настройка платформенная, через
// .env, до появления реального Админ-модуля переезжать некуда). Те же env-
// переменные, что и для Telegram-бота — секрет бэкенда, не в БД тенанта.
function getConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !port || !user || !pass || !from) return null;
  return { host, port: Number(port), user, pass, from };
}

export function isEmailConfigured(): boolean {
  return getConfig() !== null;
}

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransport() {
  const config = getConfig();
  if (!config) return null;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
  }
  return cachedTransport;
}

export async function sendEmail(
  addresses: string[],
  subject: string,
  html: string
): Promise<ChannelSendResult> {
  const config = getConfig();
  const transport = getTransport();
  if (!config || !transport) return { ok: false, error: "SMTP не настроен" };
  if (addresses.length === 0) return { ok: false, error: "Нет адресов" };

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
