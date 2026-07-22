import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSystemSettingsConfig, patchSystemSettingsConfig } from "@/lib/system-settings";

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

// Раньше только .env TELEGRAM_BOT_USERNAME — для него нет формы в
// /admin/settings (в отличие от токена), на проде он всегда оставался
// пустым, и getBindDeepLink() молча возвращал null (нашли 2026-07-11, см.
// комментарий у SystemSettingsConfig.telegramBotUsername). Теперь получаем
// сами через getMe по уже сохранённому токену и кэшируем в БД — не требует
// от админа отдельного шага, "просто работает" сразу после ввода токена.
export async function getBotUsername(): Promise<string | null> {
  const config = await getSystemSettingsConfig();
  if (config.telegramBotUsername) return config.telegramBotUsername;

  const token = await getBotToken();
  if (!token) return process.env.TELEGRAM_BOT_USERNAME || null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    const username: string | undefined = data?.result?.username;
    if (!username) return process.env.TELEGRAM_BOT_USERNAME || null;
    await patchSystemSettingsConfig({ telegramBotUsername: username });
    return username;
  } catch {
    return process.env.TELEGRAM_BOT_USERNAME || null;
  }
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

export async function getBindDeepLink(code: string): Promise<string | null> {
  const username = await getBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?startgroup=${encodeURIComponent(code)}`;
}

// Префикс payload'а в /start для клиентского флоу "узнать баланс", в отличие
// от одноразовых кодов TelegramBindCode (владельческая привязка чата) — см.
// handleClientStart в вебхуке.
export const CLIENT_START_PREFIX = "CLIENT-";

// Ссылка для клиента (не Владельца) — открывает ЛИЧНЫЙ чат с ботом
// (`?start=`, не `?startgroup=` — та ссылка добавляет бота в группу, а не
// открывает диалог 1-на-1), запускает флоу "поделиться номером → узнать
// баланс". Tenant.slug уже публичный и URL-safe (используется в /s/{slug}),
// поэтому кодируем прямо им, без отдельной таблицы одноразовых кодов —
// ссылка бессрочная и переиспользуемая (можно один раз выдать клиенту на
// чеке/в карточке).
export async function getClientBalanceDeepLink(tenantSlug: string): Promise<string | null> {
  const username = await getBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=${encodeURIComponent(CLIENT_START_PREFIX + tenantSlug)}`;
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

// Клавиатура с ОДНОЙ кнопкой request_contact — это гарантия самого Telegram
// (не наша проверка), что присланный номер принадлежит именно нажавшему
// аккаунту: подделать чужой номер через эту кнопку нельзя, в отличие от
// текстового ввода. Ключевая часть флоу "узнать баланс без PIN" — см.
// handleClientStart/handleContact в вебхуке.
export async function sendContactRequest(chatId: string, text: string, buttonText: string): Promise<TelegramApiResult> {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      keyboard: [[{ text: buttonText, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
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
