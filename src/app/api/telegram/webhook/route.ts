import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendChatMessage, sendContactRequest, CLIENT_START_PREFIX } from "@/lib/telegram-bot";
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
  } else if (update.my_chat_member) {
    await handleMyChatMember(update.my_chat_member);
  }

  // Telegram ждёт 200 в любом случае — иначе ретраит доставку того же update.
  return NextResponse.json({ ok: true });
}

async function handleStartMessage(message: { text: string; chat: { id: number; title?: string; type: string } }) {
  const match = message.text.match(/^\/start(?:@\w+)?\s+(\S+)/);
  if (!match) {
    // Голый /start без параметра — Telegram шлёт его только когда чат
    // открыли не по ссылке (например, набрали руками или нашли бота в
    // поиске). Тенанта в этом случае определить неоткуда (в отличие от
    // /start CLIENT-<slug>/<код привязки> — оба несут его в себе), поэтому
    // просто объясняем, а не молчим — раньше эта ветка вообще ничего не
    // отвечала, что выглядело как зависший бот (реальный баг, найден
    // пользователем 2026-07-22).
    if (/^\/start(?:@\w+)?\s*$/.test(message.text)) {
      await sendChatMessage(
        String(message.chat.id),
        "Чтобы узнать баланс, откройте эту переписку по ссылке, которую вам дали на точке проката."
      ).catch(() => {});
    }
    return;
  }
  const rawCode = match[1];

  // Клиентский флоу "узнать баланс" — отдельная ветка ДО uppercase, потому
  // что payload здесь не одноразовый код, а Tenant.slug (регистрозависимый,
  // тот же формат, что в публичной ссылке /s/{slug}), см.
  // getClientBalanceDeepLink в telegram-bot.ts.
  if (rawCode.startsWith(CLIENT_START_PREFIX)) {
    await handleClientStart(String(message.chat.id), rawCode.slice(CLIENT_START_PREFIX.length));
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
async function handleClientStart(chatId: string, tenantSlug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, name: true, currency: true } });
  if (!tenant) {
    await sendChatMessage(chatId, "Ссылка недействительна").catch(() => {});
    return;
  }

  const existingLink = await prisma.clientTelegramLink.findUnique({
    where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
  });
  if (existingLink) {
    const wallet = await findWalletByPhone(tenant.id, existingLink.phone);
    if (wallet) {
      await sendChatMessage(chatId, await buildClientReport(tenant, wallet)).catch(() => {});
      return;
    }
    // Кошелёк с тех пор удалили/номер сменился — привязка устарела, спросим
    // контакт заново ниже, а не покажем ошибку.
  }

  await prisma.clientBotSession.upsert({
    where: { chatId },
    create: { chatId, pendingTenantId: tenant.id },
    update: { pendingTenantId: tenant.id },
  });
  await sendContactRequest(
    chatId,
    `Чтобы узнать баланс у «${tenant.name}», поделитесь своим номером телефона — тем же, что вы называли на точке.`,
    "📱 Поделиться номером"
  ).catch(() => {});
}

// Клиент нажал кнопку "Поделиться номером" — Telegram гарантирует, что
// contact.phone_number принадлежит именно этому аккаунту (не вводится
// текстом, подделать нельзя), поэтому дальше можно доверять номеру напрямую.
async function handleContact(message: { chat: { id: number }; contact?: { phone_number: string; user_id?: number } }) {
  const chatId = String(message.chat.id);
  const contact = message.contact;
  if (!contact) return;

  const session = await prisma.clientBotSession.findUnique({ where: { chatId } });
  if (!session?.pendingTenantId) return; // контакт прислан не в ответ на наш запрос — игнорируем

  const tenantId = session.pendingTenantId;
  await prisma.clientBotSession.update({ where: { chatId }, data: { pendingTenantId: null } });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, currency: true } });
  if (!tenant) return;

  const phone = normalizePhone(contact.phone_number);
  const wallet = await findWalletByPhone(tenant.id, phone);
  if (!wallet) {
    await sendChatMessage(chatId, `Клиент с номером ${contact.phone_number} не найден у «${tenant.name}»`).catch(() => {});
    return;
  }

  await prisma.clientTelegramLink.upsert({
    where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
    create: { tenantId: tenant.id, chatId, phone },
    update: { phone },
  });

  await sendChatMessage(chatId, await buildClientReport(tenant, wallet)).catch(() => {});
}

const HISTORY_LIMIT = 5;

// Баланс + последние операции + непогашенные заказы билетов — всё одним
// сообщением (запрос пользователя 2026-07-22: клиент не должен разбираться в
// отдельных командах, один тап по кнопке даёт полную картину сразу).
async function buildClientReport(
  tenant: { id: string; name: string; currency: string | null },
  wallet: { id: string; balance: unknown }
): Promise<string> {
  const currency = tenant.currency as CurrencyCode | null;
  const lines = [`«${tenant.name}»`, `Ваш баланс: <b>${formatMoneyWithCurrency(Number(wallet.balance), "ru", currency)}</b>`];

  const history = await prisma.abonementTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { occurredAt: "desc" },
    take: HISTORY_LIMIT,
    select: { type: true, amount: true, occurredAt: true },
  });
  if (history.length > 0) {
    lines.push("", "<b>Последние операции:</b>");
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
    lines.push("", "<b>Неиспользованные заказы:</b>");
    for (const o of openOrders) {
      lines.push(`№${o.number} — ${o.openTicketsCount} билет(ов)`);
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
// команды, разное значение в зависимости от типа чата.
async function handleGroupCommand(message: { text: string; chat: { id: number } }) {
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
  // Direct Messages). Работает только если чат УЖЕ проходил проверку
  // контактом хотя бы раз (см. handleContact) — иначе неоткуда взять номер,
  // просить его текстом здесь нельзя (та же причина, что у handleClientStart:
  // это открыло бы ровно ту дыру с угадыванием номера, которой опасался
  // пользователь).
  if (/^\/balance(?:@\w+)?/.test(text)) {
    await handlePrivateBalanceCommand(chatId);
  }
}

async function handlePrivateBalanceCommand(chatId: string) {
  const links = await prisma.clientTelegramLink.findMany({ where: { chatId } });
  if (links.length === 0) {
    await sendChatMessage(
      chatId,
      "Чтобы узнать баланс, откройте эту переписку по ссылке, которую вам дали на точке проката."
    ).catch(() => {});
    return;
  }

  for (const link of links) {
    const tenant = await prisma.tenant.findUnique({ where: { id: link.tenantId }, select: { id: true, name: true, currency: true } });
    if (!tenant) continue;
    const wallet = await findWalletByPhone(tenant.id, link.phone);
    if (!wallet) continue;
    await sendChatMessage(chatId, await buildClientReport(tenant, wallet)).catch(() => {});
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

async function handleGroupBalanceCommand(chatId: string, tenantId: string, phoneArg: string) {
  if (!phoneArg) {
    await sendChatMessage(chatId, "Формат: /balance 79001234567").catch(() => {});
    return;
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) return;

  const wallet = await findWalletByPhone(tenantId, phoneArg);
  if (!wallet) {
    await sendChatMessage(chatId, `Клиент с номером ${phoneArg} не найден`).catch(() => {});
    return;
  }

  const currency = tenant.currency as CurrencyCode | null;
  const label = wallet.name ? `${wallet.name} (${wallet.phone})` : wallet.phone;
  await sendChatMessage(
    chatId,
    `${label}\nБаланс: <b>${formatMoneyWithCurrency(Number(wallet.balance), "ru", currency)}</b>`
  ).catch(() => {});
}
