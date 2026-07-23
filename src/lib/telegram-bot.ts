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

// Фото с подписью (запрос пользователя 2026-07-23, рассылка клиентам) —
// photoUrl передаётся Telegram'у как обычная ссылка (photo: <URL>), сам файл
// прокачивать через наш сервер не нужно — Bot API умеет скачать его сам,
// достаточно чтобы ссылка была публично доступна (как и наши /uploads/...,
// см. src/lib/uploads.ts). caption ограничен Telegram 1024 символами —
// вызывающий код отвечает за то, чтобы влезало.
export async function sendPhotoMessage(chatId: string, photoUrl: string, caption: string): Promise<TelegramApiResult> {
  return callTelegramApi("sendPhoto", { chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" });
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

// Постоянное меню клиента (запрос пользователя 2026-07-25: кнопки "/balance"
// и "/services" вместо набора команд руками, как уже была кнопка "Поделиться
// номером") — reply-клавиатура, не inline: живёт в самом чате (composer), не
// привязана к одному сообщению, автоматически вытесняет предыдущую
// клавиатуру (в частности, request_contact) без отдельного шага удаления —
// Telegram просто заменяет один reply_markup.keyboard другим. Текст кнопки —
// буквально сама команда ("/balance"/"/services"), не человекочитаемая
// подпись: тап шлёт этот текст обычным сообщением, тот же regex в вебхуке
// уже её понимает без доп. кода, одинаково на всех 15 языках бота.
const CLIENT_MENU_KEYBOARD = {
  keyboard: [[{ text: "/balance" }, { text: "/services" }]],
  resize_keyboard: true,
};

export async function sendChatMessageWithMenu(chatId: string, text: string): Promise<TelegramApiResult> {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: CLIENT_MENU_KEYBOARD,
  });
}

// Инлайн-кнопки под сообщением (не заменяет обычную клавиатуру ввода, в
// отличие от sendContactRequest) — список кликабельных вариантов вместо
// ручного набора текста, например "выбери клиента, а не набирай его номер
// руками" (запрос пользователя 2026-07-22, экран /balance в групповом чате).
// Каждая кнопка — своя строка (проще читать список имён, чем ужимать в
// колонки). callbackData ограничен Telegram 64 байтами — вызывающий код
// отвечает за то, чтобы влезало (id из cuid() укладывается с большим запасом).
// callbackData — тап обрабатывает наш вебхук (см. handleCallbackQuery);
// url — обычная ссылка, Telegram открывает её сам, к нам вообще не
// обращаясь (запрос пользователя 2026-07-24: кнопка "Открыть сайт" на
// лендинг тенанта). Каждая кнопка — своя строка, тот же принцип, что уже
// был у флоу выбора клиента в группе.
type InlineKeyboardButton = { text: string; callbackData: string } | { text: string; url: string };

export async function sendInlineKeyboard(chatId: string, text: string, buttons: InlineKeyboardButton[]): Promise<TelegramApiResult> {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buttons.map((b) => [
        "url" in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callbackData },
      ]),
    },
  });
}

// Обязательный ответ на нажатие инлайн-кнопки — без него у пользователя
// крутится "часики" на кнопке до таймаута Telegram (документированное
// поведение Bot API, не опционально для нормального UX).
export async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  await callTelegramApi("answerCallbackQuery", { callback_query_id: callbackQueryId }).catch(() => {});
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
