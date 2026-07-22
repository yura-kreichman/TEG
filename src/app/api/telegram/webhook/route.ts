import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendChatMessage, sendContactRequest, sendInlineKeyboard, answerCallbackQuery, CLIENT_START_PREFIX } from "@/lib/telegram-bot";
import { findWalletByPhone, normalizePhone } from "@/lib/abonement";
import { formatMoneyWithCurrency } from "@/lib/format";
import type { CurrencyCode } from "@/lib/currency";
import { getPointCashBalance } from "@/lib/zone-balance";

// Обработчик вебхука платформенного бота (docs/spec/telegram-summaries.md).
// Публичный эндпоинт по определению (Telegram сам его дёргает) — единственная
// защита: секретный заголовок, который Telegram присылает как есть, если он
// был передан при регистрации через setWebhook({ secret_token }). Без
// TELEGRAM_WEBHOOK_SECRET в конфиге эндпоинт отклоняет все запросы.
export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const gotSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (gotSecret !== expectedSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update = await request.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });

  if (update.message?.contact) {
    await handleContact(update.message);
  } else if (update.message?.text) {
    if (/^\/start(?:@\w+)?(\s|$)/.test(update.message.text)) {
      await handleStartMessage(update.message);
    } else {
      await handleGroupCommand(update.message);
    }
  } else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  } else if (update.my_chat_member) {
    await handleMyChatMember(update.my_chat_member);
  }

  // Telegram ждёт 200 в любом случае — иначе ретраит доставку того же update.
  return NextResponse.json({ ok: true });
}

// --- Локализация клиентских сообщений (запрос пользователя 2026-07-22:
// "язык ответов бота должен определяться сам... если Телеграм на русском, то
// на русском, на любом другом пока на английском, ведь локализации ещё нет")
// — двухъязычная, НЕ через полноценный lang/*.json (это plain-text сообщения
// в Telegram, не React UI). Источник — Telegram-нативное поле
// message.from.language_code (IETF-тег интерфейса аккаунта клиента, не
// текста конкретного сообщения) — платформа уже это знает, отдельно
// спрашивать язык не нужно. ТОЛЬКО для клиентских сообщений (баланс/история/
// заказы) — сообщения Владельцу/Сотруднику (групповые команды, привязка
// сводок) остаются на русском, тот же принцип, что уже действует в проекте
// для остальных бот-сообщений этой группы.
type BotLang = "ru" | "en";
function pickBotLang(languageCode?: string): BotLang {
  return languageCode?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

const BOT_STRINGS: Record<
  BotLang,
  {
    shareButton: string;
    startHintGeneric: string;
    startHintTenant: (name: string) => string;
    linkInvalid: string;
    notFoundGeneric: (phone: string) => string;
    notFoundTenant: (phone: string, name: string) => string;
    yourBalance: string;
    recentOps: string;
    openOrders: string;
    ticketsWord: string;
  }
> = {
  ru: {
    shareButton: "📱 Поделиться номером",
    startHintGeneric: "Чтобы узнать баланс, поделитесь своим номером телефона — тем же, что вы называли на точке проката.",
    startHintTenant: (name) =>
      `Чтобы узнать баланс у «${name}», поделитесь своим номером телефона — тем же, что вы называли на точке.`,
    linkInvalid: "Ссылка недействительна",
    notFoundGeneric: (phone) => `Клиент с номером ${phone} не найден ни у одного проката`,
    notFoundTenant: (phone, name) => `Клиент с номером ${phone} не найден у «${name}»`,
    yourBalance: "Ваш баланс",
    recentOps: "Последние операции",
    openOrders: "Неиспользованные заказы",
    ticketsWord: "билет(ов)",
  },
  en: {
    shareButton: "📱 Share phone number",
    startHintGeneric: "To check your balance, share your phone number — the same one you gave at the rental point.",
    startHintTenant: (name) =>
      `To check your balance at "${name}", share your phone number — the same one you gave at the point.`,
    linkInvalid: "This link is no longer valid",
    notFoundGeneric: (phone) => `No client found with number ${phone}`,
    notFoundTenant: (phone, name) => `No client found with number ${phone} at "${name}"`,
    yourBalance: "Your balance",
    recentOps: "Recent transactions",
    openOrders: "Unused orders",
    ticketsWord: "ticket(s)",
  },
};

async function handleStartMessage(message: {
  text: string;
  chat: { id: number; title?: string; type: string };
  from?: { language_code?: string };
}) {
  const lang = pickBotLang(message.from?.language_code);
  const match = message.text.match(/^\/start(?:@\w+)?\s+(\S+)/);
  if (!match) {
    // Голый /start без параметра — Telegram шлёт его только когда чат
    // открыли не по ссылке (например, набрали руками или нашли бота в
    // поиске). РАНЬШЕ тут просто объясняли "откройте по ссылке" и на этом
    // всё — реальный баг, найден пользователем 2026-07-22: "нет никакой
    // инструкции"/"не просит поделиться телефоном". Ссылка конкретного
    // тенанта на самом деле не обязательна: телефон проверяется Telegram'ом
    // (request_contact), а тенанта после этого можно найти ПО НОМЕРУ,
    // поискав кошелёк сразу среди всех тенантов платформы (см. ветку
    // pendingTenantId===null в handleContact ниже) — ссылка из карточки
    // клиента остаётся лишь удобным способом сразу узнать тенанта, не
    // единственным путём.
    if (/^\/start(?:@\w+)?\s*$/.test(message.text)) {
      await promptContactShare(String(message.chat.id), null, undefined, lang);
    }
    return;
  }
  const rawCode = match[1];

  // Клиентский флоу "узнать баланс" — отдельная ветка ДО uppercase, потому
  // что payload здесь не одноразовый код, а Tenant.slug (регистрозависимый,
  // тот же формат, что в публичной ссылке /s/{slug}), см.
  // getClientBalanceDeepLink в telegram-bot.ts.
  if (rawCode.startsWith(CLIENT_START_PREFIX)) {
    await handleClientStart(String(message.chat.id), rawCode.slice(CLIENT_START_PREFIX.length), lang);
    return;
  }

  const code = rawCode.toUpperCase();

  const bindCode = await prisma.telegramBindCode.findUnique({ where: { code } });
  if (!bindCode || bindCode.usedAt || bindCode.expiresAt < new Date()) return;

  const chatId = String(message.chat.id);
  const chatTitle = message.chat.title ?? null;

  // Сетевые вызовы (уведомление старого чата, подтверждение новому) — ПОСЛЕ
  // транзакции, не внутри: транзакция должна быть только про БД, а сеть может
  // зависнуть/упасть без влияния на консистентность записанного.
  const notifyOldChatId = await prisma.$transaction(async (tx) => {
    await tx.telegramBindCode.update({ where: { id: bindCode.id }, data: { usedAt: new Date() } });

    // Пересвязка: если уже была активная привязка на другой чат — деактивируем
    // старую запись, а не перезаписываем (сохраняем историю, см. схему).
    const existing = await tx.tenantSummaryChannel.findFirst({
      where: { tenantId: bindCode.tenantId, channelType: "telegram", pointId: null },
    });

    if (existing && existing.chatId === chatId) {
      // Тот же чат перепривязался (например, бота добавили заново) — просто
      // реактивируем существующую запись вместо дубликата.
      await tx.tenantSummaryChannel.update({
        where: { id: existing.id },
        data: { enabled: true, chatStatus: "active", chatTitle },
      });
      return null;
    }

    if (existing) {
      await tx.tenantSummaryChannel.update({
        where: { id: existing.id },
        data: { enabled: false, chatStatus: "inactive" },
      });
    }
    await tx.tenantSummaryChannel.create({
      data: {
        tenantId: bindCode.tenantId,
        channelType: "telegram",
        enabled: true,
        chatId,
        chatTitle,
        chatStatus: "active",
      },
    });
    return existing?.chatId ?? null;
  });

  if (notifyOldChatId) {
    await sendChatMessage(notifyOldChatId, "Сводки переведены в другой чат").catch(() => {});
  }
  await sendChatMessage(chatId, "✅ RentOS подключён к этому чату").catch(() => {});
}

async function handleMyChatMember(update: {
  chat: { id: number };
  new_chat_member: { status: string };
}) {
  const status = update.new_chat_member?.status;
  if (status !== "left" && status !== "kicked") return;

  const chatId = String(update.chat.id);
  await prisma.tenantSummaryChannel.updateMany({
    where: { channelType: "telegram", chatId },
    data: { chatStatus: "inactive" },
  });
}

// Клиент открыл ссылку t.me/<bot>?start=CLIENT-<slug> — либо у него уже есть
// подтверждённая привязка для этого тенанта (быстрый путь: сразу баланс, без
// повторного запроса контакта), либо просим поделиться номером.
async function handleClientStart(chatId: string, tenantSlug: string, lang: BotLang) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, name: true, currency: true } });
  if (!tenant) {
    await sendChatMessage(chatId, BOT_STRINGS[lang].linkInvalid).catch(() => {});
    return;
  }

  const existingLink = await prisma.clientTelegramLink.findUnique({
    where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
  });
  if (existingLink) {
    const wallet = await findWalletByPhone(tenant.id, existingLink.phone);
    if (wallet) {
      await sendChatMessage(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
      return;
    }
    // Кошелёк с тех пор удалили/номер сменился — привязка устарела, спросим
    // контакт заново ниже, а не покажем ошибку.
  }

  await promptContactShare(chatId, tenant.id, tenant.name, lang);
}

// pendingTenantId === null — "generic" запрос (голый /start, голый /balance
// без предыдущей привязки): тенант неизвестен заранее, определится по
// присланному номеру (см. handleContact — ищет кошелёк сразу по всем
// тенантам). pendingTenantId === "<id>" — "scoped" запрос из конкретной
// ссылки клиента (t.me/...?start=CLIENT-<slug>), ищем кошелёк только у этого
// тенанта.
async function promptContactShare(chatId: string, tenantId: string | null, tenantName: string | undefined, lang: BotLang) {
  await prisma.clientBotSession.upsert({
    where: { chatId },
    create: { chatId, pendingTenantId: tenantId },
    update: { pendingTenantId: tenantId },
  });
  const s = BOT_STRINGS[lang];
  const text = tenantName ? s.startHintTenant(tenantName) : s.startHintGeneric;
  await sendContactRequest(chatId, text, s.shareButton).catch(() => {});
}

// Клиент нажал кнопку "Поделиться номером" — Telegram гарантирует, что
// contact.phone_number принадлежит именно этому аккаунту (не вводится
// текстом, подделать нельзя), поэтому дальше можно доверять номеру напрямую.
async function handleContact(message: {
  chat: { id: number };
  contact?: { phone_number: string; user_id?: number };
  from?: { language_code?: string };
}) {
  const chatId = String(message.chat.id);
  const contact = message.contact;
  if (!contact) return;
  const lang = pickBotLang(message.from?.language_code);

  const session = await prisma.clientBotSession.findUnique({ where: { chatId } });
  if (!session) return; // контакт прислан не в ответ на наш запрос — игнорируем

  const pendingTenantId = session.pendingTenantId;
  await prisma.clientBotSession.update({ where: { chatId }, data: { pendingTenantId: null } });

  const phone = normalizePhone(contact.phone_number);
  const s = BOT_STRINGS[lang];

  if (pendingTenantId) {
    // Scoped-флоу — конкретная ссылка тенанта, ищем только там.
    const tenant = await prisma.tenant.findUnique({ where: { id: pendingTenantId }, select: { id: true, name: true, currency: true } });
    if (!tenant) return;
    const wallet = await findWalletByPhone(tenant.id, phone);
    if (!wallet) {
      await sendChatMessage(chatId, s.notFoundTenant(contact.phone_number, tenant.name)).catch(() => {});
      return;
    }
    await prisma.clientTelegramLink.upsert({
      where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
      create: { tenantId: tenant.id, chatId, phone },
      update: { phone },
    });
    await sendChatMessage(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
    return;
  }

  // Generic-флоу — тенант неизвестен заранее (голый /start, ссылка не
  // использовалась), ищем кошелёк с этим номером СРАЗУ по всем тенантам
  // платформы: один и тот же человек вполне может быть клиентом нескольких
  // разных прокатов на RentOS, отправляем отчёт по каждому найденному.
  const wallets = await prisma.abonementWallet.findMany({ where: { phone } });
  if (wallets.length === 0) {
    await sendChatMessage(chatId, s.notFoundGeneric(contact.phone_number)).catch(() => {});
    return;
  }

  for (const wallet of wallets) {
    const tenant = await prisma.tenant.findUnique({ where: { id: wallet.tenantId }, select: { id: true, name: true, currency: true } });
    if (!tenant) continue;
    await prisma.clientTelegramLink.upsert({
      where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
      create: { tenantId: tenant.id, chatId, phone },
      update: { phone },
    });
    await sendChatMessage(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
  }
}

const HISTORY_LIMIT = 5;

// Баланс + последние операции + непогашенные заказы билетов — всё одним
// сообщением (запрос пользователя 2026-07-22: клиент не должен разбираться в
// отдельных командах, один тап по кнопке даёт полную картину сразу).
async function buildClientReport(
  tenant: { id: string; name: string; currency: string | null },
  wallet: { id: string; balance: unknown },
  lang: BotLang
): Promise<string> {
  const s = BOT_STRINGS[lang];
  const currency = tenant.currency as CurrencyCode | null;
  const lines = [`«${tenant.name}»`, `${s.yourBalance}: <b>${formatMoneyWithCurrency(Number(wallet.balance), "ru", currency)}</b>`];

  const history = await prisma.abonementTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { occurredAt: "desc" },
    take: HISTORY_LIMIT,
    select: { type: true, amount: true, occurredAt: true },
  });
  if (history.length > 0) {
    lines.push("", `<b>${s.recentOps}:</b>`);
    for (const h of history) {
      const sign = h.type === "spend" ? "−" : "+";
      const date = h.occurredAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
      lines.push(`${date}  ${sign}${formatMoneyWithCurrency(Number(h.amount), "ru", currency)}`);
    }
  }

  // Билеты — единственный режим, где оплата и использование разнесены во
  // времени (docs/spec/10-tickets.md), только тут есть смысл понятия
  // "оплачено, но ещё не использовано" — см. обсуждение с пользователем
  // 2026-07-22. У Счётчиков/Пусков/Прибываний оплата = мгновенное
  // использование, показывать там нечего.
  const openOrders = await prisma.ticketOrder.findMany({
    where: { walletId: wallet.id, openTicketsCount: { gt: 0 } },
    orderBy: { soldAt: "desc" },
    select: { number: true, openTicketsCount: true },
  });
  if (openOrders.length > 0) {
    lines.push("", `<b>${s.openOrders}:</b>`);
    for (const o of openOrders) {
      lines.push(`№${o.number} — ${o.openTicketsCount} ${s.ticketsWord}`);
    }
  }

  return lines.join("\n");
}

// Команды для Сотрудника/Владельца ПРЯМО В том групповом чате, который уже
// подключён для сводок (TenantSummaryChannel) — доверие тут держится не на
// "знает номер клиента" (как у клиентского флоу выше), а на "состоит в
// приватной группе, куда позвал Владелец" — совсем другая, более широкая
// модель, поэтому /balance тут безопасно принимает номер прямым текстом
// (запрос пользователя 2026-07-22: "можно чтобы и Сотрудник что-то
// спрашивал"). Если chatId не найден в TenantSummaryChannel — это НЕ группа
// тенанта, а либо посторонний чат, либо личный чат клиента: там /balance
// означает другое (см. handlePrivateBalanceCommand ниже) — тот же текст
// команды, разное значение в зависимости от типа чата. Групповые ответы
// остаются на русском (Владелец/Сотрудник, не клиент) — не путать с
// BOT_STRINGS выше, тот словарь только для клиентских сообщений.
async function handleGroupCommand(message: { text: string; chat: { id: number }; from?: { language_code?: string } }) {
  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const channel = await prisma.tenantSummaryChannel.findFirst({
    where: { channelType: "telegram", chatId },
    select: { tenantId: true },
  });

  if (channel) {
    if (/^\/kassa(?:@\w+)?/.test(text)) {
      await handleKassaCommand(chatId, channel.tenantId);
    } else if (/^\/balance(?:@\w+)?/.test(text)) {
      const phoneArg = text.replace(/^\/balance(?:@\w+)?\s*/, "");
      await handleGroupBalanceCommand(chatId, channel.tenantId, phoneArg);
    }
    return;
  }

  // Личный чат клиента: /balance тут без аргумента — просто "покажи мой
  // баланс ещё раз" (та же команда, что зарегистрирована в BotFather для
  // Direct Messages). Если чат ещё ни разу не проходил проверку контактом —
  // предлагаем это сделать сразу же (тот же generic-флоу, что у голого
  // /start), а не просто отсылаем к ссылке.
  if (/^\/balance(?:@\w+)?/.test(text)) {
    await handlePrivateBalanceCommand(chatId, pickBotLang(message.from?.language_code));
  }
}

async function handlePrivateBalanceCommand(chatId: string, lang: BotLang) {
  const links = await prisma.clientTelegramLink.findMany({ where: { chatId } });
  if (links.length === 0) {
    await promptContactShare(chatId, null, undefined, lang);
    return;
  }

  for (const link of links) {
    const tenant = await prisma.tenant.findUnique({ where: { id: link.tenantId }, select: { id: true, name: true, currency: true } });
    if (!tenant) continue;
    const wallet = await findWalletByPhone(tenant.id, link.phone);
    if (!wallet) continue;
    await sendChatMessage(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
  }
}

async function handleKassaCommand(chatId: string, tenantId: string) {
  const [tenant, points] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    prisma.point.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!tenant || points.length === 0) {
    await sendChatMessage(chatId, "Нет ни одной точки").catch(() => {});
    return;
  }

  const currency = tenant.currency as CurrencyCode | null;
  const balances = await Promise.all(points.map((p) => getPointCashBalance(p.id)));
  const total = balances.reduce((sum, b) => sum + b, 0);

  const lines = ["<b>Касса сейчас:</b>"];
  points.forEach((p, i) => {
    lines.push(`${p.name}: ${formatMoneyWithCurrency(balances[i], "ru", currency)}`);
  });
  if (points.length > 1) {
    lines.push("", `Итого: <b>${formatMoneyWithCurrency(total, "ru", currency)}</b>`);
  }

  await sendChatMessage(chatId, lines.join("\n")).catch(() => {});
}

const RECENT_CLIENTS_LIMIT = 8;
const BALANCE_CALLBACK_PREFIX = "bal:";

async function handleGroupBalanceCommand(chatId: string, tenantId: string, phoneArg: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) return;

  if (!phoneArg) {
    // Без номера — не текстовая подсказка "введите формат" (запрос
    // пользователя 2026-07-22: "владельцу не нужно вводить номер руками,
    // пусть подставляются клиенты у которых есть баланс, а если нет — нет
    // смысла присылать такие сообщения"), а список реальных клиентов
    // кнопками — тапнул и сразу баланс, вводить ничего не нужно. Раз клиентов
    // на тенанте нет вообще — молчим, а не шлём бесполезное сообщение.
    const clients = await prisma.abonementWallet.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      take: RECENT_CLIENTS_LIMIT,
      select: { id: true, name: true, phone: true, balance: true },
    });
    if (clients.length === 0) return;

    const currency = tenant.currency as CurrencyCode | null;
    const buttons = clients.map((c) => ({
      text: `${c.name ? `${c.name} (${c.phone})` : c.phone} — ${formatMoneyWithCurrency(Number(c.balance), "ru", currency)}`,
      callbackData: `${BALANCE_CALLBACK_PREFIX}${c.id}`,
    }));
    await sendInlineKeyboard(chatId, "Выберите клиента:", buttons).catch(() => {});
    return;
  }

  const wallet = await findWalletByPhone(tenantId, phoneArg);
  if (!wallet) {
    await sendChatMessage(chatId, `Клиент с номером ${phoneArg} не найден`).catch(() => {});
    return;
  }
  await sendWalletBalanceReply(chatId, tenant.currency, wallet);
}

async function sendWalletBalanceReply(
  chatId: string,
  currencyRaw: string | null,
  wallet: { name: string | null; phone: string; balance: unknown }
) {
  const currency = currencyRaw as CurrencyCode | null;
  const label = wallet.name ? `${wallet.name} (${wallet.phone})` : wallet.phone;
  await sendChatMessage(
    chatId,
    `${label}\nБаланс: <b>${formatMoneyWithCurrency(Number(wallet.balance), "ru", currency)}</b>`
  ).catch(() => {});
}

// Нажатие кнопки клиента из списка (см. handleGroupBalanceCommand выше) —
// tenantId для проверки берём из TenantSummaryChannel по chatId, а не
// доверяем чему-то в самом callback_data: коллбэк технически мог прийти
// только из чата, где мы сами показали эту клавиатуру (Telegram не позволяет
// подделать чужой чат), но лишняя проверка "кошелёк реально принадлежит
// этому тенанту" ничего не стоит и на всякий случай не помешает.
async function handleCallbackQuery(callbackQuery: { id: string; data?: string; message?: { chat: { id: number } } }) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message ? String(callbackQuery.message.chat.id) : null;
  await answerCallbackQuery(callbackQuery.id);
  if (!data || !chatId || !data.startsWith(BALANCE_CALLBACK_PREFIX)) return;

  const channel = await prisma.tenantSummaryChannel.findFirst({
    where: { channelType: "telegram", chatId },
    select: { tenantId: true },
  });
  if (!channel) return;

  const walletId = data.slice(BALANCE_CALLBACK_PREFIX.length);
  const wallet = await prisma.abonementWallet.findUnique({ where: { id: walletId } });
  if (!wallet || wallet.tenantId !== channel.tenantId) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: channel.tenantId }, select: { currency: true } });
  if (!tenant) return;

  await sendWalletBalanceReply(chatId, tenant.currency, wallet);
}
