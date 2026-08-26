import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSystemSettingsConfig, patchSystemSettingsConfig } from "@/lib/system-settings";
import type { BotStringSet } from "@/lib/telegram-client-i18n";

// Единый платформенный бот на всех тенантов (docs/spec/telegram-summaries.md) —
// НЕ путать со старым src/lib/telegram.ts (Tenant.telegramBotToken, бот на
// тенанта), который остаётся рабочим до Шага 3/4, где точки отправки
// переключаются на эту систему, а старая карта настроек в /settings убирается.
// Токен — платформенная настройка (docs/spec/06-super-admin.md, /admin/settings),
// БД первична, .env (TELEGRAM_BOT_TOKEN) — тихий фоллбэк на переходный период.
// Экранирование пользовательских данных (имена зон/тарифов/точек/клиентов)
// перед вставкой в текст сообщения — все клиентские сообщения уходят с
// parse_mode: "HTML" (см. sendMessage ниже), без экранирования "<"/">"/"&" в
// названии, которое задал сам Владелец, Telegram просто откажет в отправке
// (ошибка парсинга entities) — найдено при аудите форматирования 2026-07-25.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

// adminRights — штатный параметр Telegram (core.telegram.org/api/links,
// "Bot add-to-group links"): перечисленные через "+" права запрашиваются
// прямо в диалоге добавления, человек видит переключатель и подтверждает их
// одним движением. Без него бот добавляется обычным участником.
//
// Заведено 2026-08-15 по вопросу владельца «а мы информируем, что боту нужны
// права администратора?». Не информировали — и не могли бы: шторка обещает
// «без токенов и настроек, один тап», объяснение прав туда не вписывается.
// Клиентской группе право нужно ровно одно, invite_users: без него
// exportChatInviteLink отвечает отказом, ссылка-приглашение не приезжает,
// /join говорит «группа не настроена» и кнопки на лендинге не появляется —
// причём владелец никак не свяжет это с правами. Остальные права (удаление
// сообщений, закрепление, блокировка участников) боту не нужны и не просятся.
export async function getBindDeepLink(code: string, adminRights?: string): Promise<string | null> {
  const username = await getBotUsername();
  if (!username) return null;
  const admin = adminRights ? `&admin=${adminRights}` : "";
  return `https://t.me/${username}?startgroup=${encodeURIComponent(code)}${admin}`;
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

const TELEGRAM_MAX_ATTEMPTS = 3;
const TELEGRAM_RETRY_DELAYS_MS = [1000, 3000]; // между попытками 1 и 2, 2 и 3
const TELEGRAM_MAX_RETRY_AFTER_S = 30; // потолок ожидания по 429 — дольше ждать дороже, чем отдать ошибку

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Повторяем ТОЛЬКО то, что имеет шанс пройти со второй попытки: обрыв сети
// (status 0 — fetch бросил), 429 (лимит: в группу Bot API пускает не больше
// 20 сообщений в минуту, core.telegram.org/bots/faq) и 5xx на стороне
// Telegram. 400/401/403 — окончательные ответы («чат не найден», «бот удалён
// из чата», негодный токен): повтор их не исправит, только задержит ответ.
function isRetryableTelegramStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

/**
 * Реальный инцидент 2026-08-26 (владелец КидсБург, сдача итогов): один
 * `fetch failed / ECONNRESET` по дороге к api.telegram.org — и сводка по зоне
 * «Машинки» не пришла НИКОГДА. Повторов не было ни одного, а само исключение
 * из fetch пробивало наверх мимо каналов: вместе с Telegram терялись email и
 * Push этой же зоны, потому что цикл каналов в dispatch обрывался на первой
 * же ошибке.
 *
 * Поэтому здесь два правила, оба обязательны:
 *   1. Наружу НИКОГДА не летит исключение — сетевой сбой это обычный
 *      `{ ok: false, status: 0 }`, такой же результат, как «чат не найден».
 *      Вызывающий код (dispatch.ts) на нём продолжает работу, а не падает.
 *   2. Повтор с паузой на сбоях, которые лечатся временем (см.
 *      isRetryableTelegramStatus), включая уважение `retry_after` из
 *      ResponseParameters — Telegram сам говорит, сколько ждать.
 *
 * Ретрай sendMessage не идемпотентен: если соединение оборвалось уже ПОСЛЕ
 * того, как Telegram принял сообщение, повтор даст дубль в чате. Это
 * сознательный размен — дубль владелец видит и понимает, молчаливую пропажу
 * зонной сводки он не видит вообще.
 */
async function callTelegramApi(method: string, body: Record<string, unknown>): Promise<TelegramApiResult> {
  const token = await getBotToken();
  if (!token) return { ok: false, status: 0, description: "bot not configured" };

  let last: TelegramApiResult = { ok: false, status: 0, description: "no attempt" };

  for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt++) {
    let retryAfterMs: number | null = null;

    try {
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

      last = { ok: false, status, description: data?.description };
      if (!isRetryableTelegramStatus(status)) return last;

      const retryAfter: unknown = data?.parameters?.retry_after;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        if (retryAfter > TELEGRAM_MAX_RETRY_AFTER_S) return last;
        retryAfterMs = retryAfter * 1000;
      }
    } catch (err) {
      // fetch бросает только на транспортных ошибках (ECONNRESET, обрыв DNS
      // и т.п.) — HTTP-ответ с 4xx/5xx сюда не попадает, он разбирается выше.
      last = { ok: false, status: 0, description: err instanceof Error ? err.message : String(err) };
    }

    if (attempt === TELEGRAM_MAX_ATTEMPTS) break;
    console.warn("telegram api retry", { method, attempt, status: last.status, description: last.description });
    await sleep(retryAfterMs ?? TELEGRAM_RETRY_DELAYS_MS[attempt - 1]);
  }

  return last;
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
// номером"; запрос 2026-07-24: понятные подписи вместо голых команд + третья
// кнопка "/join" для публичной группы анонсов) — reply-клавиатура, не
// inline: живёт в самом чате (composer), не привязана к одному сообщению,
// автоматически вытесняет предыдущую клавиатуру (в частности,
// request_contact) без отдельного шага удаления. Кнопка шлёт СВОЙ текст как
// обычное сообщение (это устройство Telegram, изменить нельзя) — поэтому
// подписи теперь человекочитаемые и локализованные (s.balanceMenuButton и
// т.п.), а вебхук матчит и их тоже, не только голые "/balance"/"/services"/
// "/join" (см. handleGroupCommand).
//
// showJoin — реальный баг, найден пользователем 2026-07-25: кнопка "Будем
// вместе" показывалась всегда, даже если у тенанта клиента группа не
// подключена или Владелец её выключил тумблером — тап приводил только к
// "Группа пока не подключена". Вызывающая сторона уже знает конкретного
// tenant для этого сообщения (buildClientReport вызывается на тенанта), ей
// и решать, включать ли третью кнопку — здесь этой информации нет.
//
// showRegister — саморегистрация (запрос пользователя 2026-07-25: "чтобы
// сами себя добавляли в базу Клиентов") — до регистрации первая кнопка
// "📝 Регистрация" вместо "💵 Баланс" (баланса ещё нет, проверять нечего).
// showBonus — та же логика, что showJoin, но для кнопки "🎁 Абонементы"
// (список планов + где купить, запрос того же дня): показывается, только
// если у тенанта вообще есть что показать (планы + активные точки).
export interface ChatMenuOptions {
  showRegister?: boolean;
  showJoin?: boolean;
  showBonus?: boolean;
}

export async function sendChatMessageWithMenu(
  chatId: string,
  text: string,
  s: BotStringSet,
  options: ChatMenuOptions = {}
): Promise<TelegramApiResult> {
  const keyboard = [[{ text: options.showRegister ? s.registerMenuButton : s.balanceMenuButton }, { text: s.servicesMenuButton }]];
  if (options.showBonus) keyboard.push([{ text: s.bonusMenuButton }]);
  if (options.showJoin) keyboard.push([{ text: s.joinMenuButton }]);
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      keyboard,
      resize_keyboard: true,
    },
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

// Подсказка "/kassa" только в конкретном рабочем чате Сотрудников (запрос
// пользователя 2026-07-25: "найдётся дурак, который будет тыкать среди
// клиентов kassa") — Владелец сам убрал /kassa из общего списка в BotFather
// (там нет прицельной настройки на один конкретный чат, только общие
// категории "Group Chats"/"Direct Messages" сразу на все группы). Прицельный
// scope {type:"chat", chat_id} есть только в Bot API, не в интерфейсе
// BotFather — выставляем его сами при каждой успешной привязке рабочего
// чата (handleStartMessage, purpose "summary"). best-effort — сбой не
// должен ломать саму привязку.
export async function setStaffGroupCommands(chatId: string): Promise<void> {
  await callTelegramApi("setMyCommands", {
    commands: [{ command: "kassa", description: "Касса сейчас" }],
    scope: { type: "chat", chat_id: chatId },
  }).catch(() => {});
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

// Удаление приветственного сообщения в группе клиентов после того, как
// человек реально перешёл по нему в бота (запрос пользователя 2026-07-25:
// "чтобы не засорять группу") — best-effort: сообщение могло быть уже
// удалено вручную, бот мог потерять права и т.п., в этих случаях просто
// молча ничего не происходит, отдельно не сообщаем об ошибке никому.
export async function deleteChatMessage(chatId: string, messageId: string): Promise<boolean> {
  const token = await getBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId) }),
    });
    // Telegram разрешает боту удалять СВОИ сообщения только первые 48 часов
    // (Bot API, deleteMessage) — дальше приходит ok:false. Возвращаем
    // результат, чтобы вызывающий код мог отступить на "переписать пометкой"
    // вместо молчаливой потери (решение владельца 2026-08-16: "я бы их всех
    // просто удалял" — удаляем, где Telegram позволяет).
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return !!json?.ok;
  } catch {
    return false;
  }
}

const BIND_CODE_TTL_MS = 15 * 60 * 1000;

// purpose: "summary" (рабочий чат — Итоги/Касса/Инструктажи) | "public_group"
// (публичная группа клиентов — запрос пользователя 2026-07-24) — вебхук
// читает bindCode.purpose и решает, в какую таблицу писать chatId
// (handleStart в webhook/route.ts).
export async function createBindCode(
  tenantId: string,
  purpose: "summary" | "public_group" = "summary"
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateBindCode();
  const expiresAt = new Date(Date.now() + BIND_CODE_TTL_MS);
  await prisma.telegramBindCode.create({ data: { tenantId, code, expiresAt, purpose } });
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

// Публичная группа тенанта (singleton, docs см. TenantPublicGroup в схеме) —
// тот же принцип, что getTenantChannel выше, но без channelType/pointId, у
// этой таблицы одна запись на тенанта по конструкции.
export async function getTenantPublicGroup(tenantId: string) {
  return prisma.tenantPublicGroup.findUnique({ where: { tenantId } });
}

// Автоматическая ссылка-приглашение (запрос пользователя 2026-07-24: "должна
// быть автоматическая") — Bot API умеет отдать её сам через
// exportChatInviteLink, НО только если бота добавили в группу админом с
// правом "приглашать пользователей по ссылке". Раньше считали это
// невозможным ("нет прав администратора") — на деле зависит от того, как
// Владелец добавил бота; если прав хватает, работает сразу, если нет —
// молча возвращает null, и страница настроек показывает ручное поле как
// раньше (страховка, не единственный путь). Вызывать только один раз, пока
// ссылки ещё нет — сам метод каждый раз ВЫПУСКАЕТ НОВУЮ ссылку и отзывает
// предыдущую, повторный вызов сломал бы уже разосланную клиентам ссылку.
export async function fetchChatInviteLink(chatId: string): Promise<string | null> {
  const token = await getBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/exportChatInviteLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = await res.json().catch(() => null);
    const link: unknown = data?.result;
    return res.ok && typeof link === "string" ? link : null;
  } catch {
    return null;
  }
}

// Уже состоит ли конкретный клиент в публичной группе тенанта (запрос
// пользователя 2026-07-25: "если Клиент уже в группе, кнопка тоже не нужна")
// — userId это тот же chatId, которым клиент общается с ботом в личке:
// у приватных чатов Telegram chat.id и user.id ВСЕГДА совпадают (устройство
// самого Bot API, не наше допущение), отдельно спрашивать/хранить
// telegram user_id клиента не нужно. null — "не удалось проверить" (бот не
// состоит в группе, пользователь никогда не писал боту и т.п.), вызывающая
// сторона в этом случае должна вести себя как раньше (кнопку показывать).
export async function isChatMember(groupChatId: string, userId: string): Promise<boolean | null> {
  const token = await getBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: groupChatId, user_id: userId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return null;
    const status: string | undefined = data?.result?.status;
    if (!status) return null;
    return status !== "left" && status !== "kicked";
  } catch {
    return null;
  }
}

// Автоанонс в публичную группу при активации новой зоны/точки/актива (запрос
// пользователя 2026-07-24) — вызывается ТОЛЬКО из PATCH-роутов при переходе
// active false→true (не из create — "создание = готовлю, включение =
// готово, объявляю", то же обсуждение). Молча ничего не делает, если группа
// не подключена/выключена/соответствующий тумблер анонса выключен — это
// норма, не ошибка. Текст на русском — группа общая, не персональный чат
// клиента, локализовать не на что (тот же принцип, что у групповых
// сообщений Владельцу/Сотруднику в вебхуке).
const ANNOUNCE_LABEL: Record<"zone" | "point" | "asset", string> = {
  zone: "Новая зона",
  point: "Новая точка",
  asset: "Новый актив",
};

export async function announceEntityActivated(
  tenantId: string,
  kind: "zone" | "point" | "asset",
  name: string
): Promise<void> {
  const group = await getTenantPublicGroup(tenantId);
  if (!group?.chatId || group.chatStatus !== "active" || !group.enabled) return;
  const flagByKind = { zone: group.announceNewZones, point: group.announceNewPoints, asset: group.announceNewAssets };
  if (!flagByKind[kind]) return;

  const text = `🎉 <b>${ANNOUNCE_LABEL[kind]}: ${name}</b>`;
  await sendChatMessage(group.chatId, text).catch(() => {});
}
