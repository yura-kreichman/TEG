import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSystemSettingsConfig } from "@/lib/system-settings";

// Единый платформенный бот на всех тенантов (docs/spec/telegram-summaries.md) —
// НЕ путать со старым src/lib/telegram.ts (Tenant.telegramBotToken, бот на
// тенанта), который остаётся рабочим до Шага 3/4, где точки отправки
// переключаются на эту систему, а старая карта настроек в /settings убирается.
// Токен — платформенная настройка (docs/spec/06-super-admin.md, /admin/settings),
// БД первична, .env (TELEGRAM_BOT_TOKEN) — тихий фоллбэк на переходный период.
async function getBotToken(): Promise<string | null> {
  const { telegramBotToken } = await getSystemSettingsConfig();
  return telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || null;
}

export function getBotUsername(): string | null {
  return process.env.TELEGRAM_BOT_USERNAME || null;
}

export async function isBotConfigured(): Promise<boolean> {
  return !!(await getBotToken());
}

const BIND_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // без 0/O/1/I/L — не спутать при ручном вводе

export function generateBindCode(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (const b of bytes) {
    code += BIND_CODE_ALPHABET[b % BIND_CODE_ALPHABET.length];
  }
  return `RT-${code}`;
}

export function getBindDeepLink(code: string): string | null {
  const username = getBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?startgroup=${encodeURIComponent(code)}`;
}

interface TelegramApiResult {
  ok: boolean;
  status: number;
  description?: string;
  messageId?: string;
}

async function callTelegramApi(method: string, body: Record<string, unknown>): Promise<TelegramApiResult> {
  const token = await getBotToken();
  if (!token) return { ok: false, status: 0, description: "bot not configured" };

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const status = res.status;
  const data = await res.json().catch(() => null);
  if (res.ok) {
    const messageId = data?.result?.message_id;
    return { ok: true, status, messageId: messageId != null ? String(messageId) : undefined };
  }

  return { ok: false, status, description: data?.description };
}

export async function sendChatMessage(chatId: string, text: string): Promise<TelegramApiResult> {
  return callTelegramApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

export async function editChatMessage(
  chatId: string,
  messageId: string,
  text: string
): Promise<TelegramApiResult> {
  return callTelegramApi("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" });
}

// docs/spec/telegram-summaries.md, "Маппинг ошибок Bot API" — 401 это НАША
// ошибка конфигурации (неверный/протухший токен бота), не владельца.
export function mapTelegramApiError(result: TelegramApiResult): string {
  if (result.status === 401) return "Ошибка конфигурации бота — обратитесь в поддержку";
  if (result.status === 400 && /chat not found/i.test(result.description ?? "")) return "Чат не найден";
  if (result.status === 403) return "Бот удалён из чата — добавьте его снова";
  if (result.status === 0) return "Бот не настроен";
  return "Не удалось отправить сообщение в Telegram";
}

const BIND_CODE_TTL_MS = 15 * 60 * 1000;

export async function createBindCode(tenantId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateBindCode();
  const expiresAt = new Date(Date.now() + BIND_CODE_TTL_MS);
  await prisma.telegramBindCode.create({ data: { tenantId, code, expiresAt } });
  return { code, expiresAt };
}

// Общий чат тенанта (pointId=null) — единственный режим, который использует UI
// сейчас; точечные привязки — задел на будущее (см. схему).
export async function getTenantChannel(tenantId: string, channelType: "telegram" | "email") {
  return prisma.tenantSummaryChannel.findFirst({
    where: { tenantId, channelType, pointId: null },
    orderBy: { createdAt: "desc" },
  });
}
