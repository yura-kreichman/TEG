import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendChatMessage, sendChatMessageWithMenu, sendContactRequest, sendInlineKeyboard, answerCallbackQuery, CLIENT_START_PREFIX } from "@/lib/telegram-bot";
import { findWalletByPhone, normalizePhone } from "@/lib/abonement";
import { formatMoneyWithCurrency } from "@/lib/format";
import type { CurrencyCode } from "@/lib/currency";
import { getBusinessDayBounds } from "@/lib/business-day";
import { buildDailyCashSummaryData } from "@/lib/summary-channels/daily-cash-data";
import { DAILY_CASH_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { pickBotLang, BOT_STRINGS, greetingLine } from "@/lib/telegram-client-i18n";
import type { Locale } from "@/lib/locales";
import { timingSafeEqualStrings } from "@/lib/timing-safe-equal";
import { isModuleEnabled } from "@/lib/tenant-modules";

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
  if (!gotSecret || !timingSafeEqualStrings(gotSecret, expectedSecret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update = await request.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });

  // try/catch вокруг всего диспетчера (аудит 2026-07-25, финальный проход) —
  // ниже уже было заявлено "Telegram ждёт 200 в любом случае — иначе ретраит
  // доставку того же update", но само тело диспетчера ничем не было от этого
  // защищено: необработанное исключение в любом из обработчиков (например,
  // временный сбой БД внутри buildDailyCashSummaryData у /kassa) уводило
  // ошибку наружу из POST, Next.js отвечал 500, и Telegram переотправлял бы
  // тот же update заново — тихий сбой команды превращался в цикл ретраев
  // вместо того, чтобы просто ничего не ответить в чат в этот раз.
  try {
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
  } catch (err) {
    console.error("telegram webhook handler failed", err);
  }

  // Telegram ждёт 200 в любом случае — иначе ретраит доставку того же update.
  return NextResponse.json({ ok: true });
}

// Локализация клиентских сообщений — словарь и подбор языка вынесены в
// src/lib/telegram-client-i18n.ts (переиспользуется также notifyWalletBalanceChange
// в abonement.ts и напоминаниями об истечении билетов в summary-scheduler.ts,
// поэтому не может жить только здесь). ТОЛЬКО для клиентских сообщений —
// сообщения Владельцу/Сотруднику (групповые команды, привязка сводок)
// остаются на русском.
type BotLang = Locale;

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
  let alreadyUsed = false;
  const notifyOldChatId = await prisma.$transaction(async (tx) => {
    // CAS вместо обычного update (аудит 2026-07-25, повторная проверка): чтение
    // usedAt выше — ДО транзакции; Telegram гарантирует лишь "at least once"
    // доставку вебхука — два почти одновременных дубля апдейта с одним и тем
    // же кодом оба проходили эту проверку и оба выполняли транзакцию, создавая
    // задвоенный/лишний TenantSummaryChannel. where с usedAt:null — если код
    // уже использован параллельным дублем, updateMany затронет 0 строк.
    const claimed = await tx.telegramBindCode.updateMany({
      where: { id: bindCode.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      alreadyUsed = true;
      return null;
    }

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

  if (alreadyUsed) return;

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
  // Тумблер "Клиенты" (Настройки → Система) — серверная проверка, не только
  // скрытие в UI кабинета (аудит 2026-07-25, финальный проход, тот же
  // принцип, что уже применён к goodsAccess/goodsAllowBalancePayment): без
  // неё выключенный владельцем модуль всё равно продолжал бы выдавать
  // баланс/историю клиентам через уже привязанные Telegram-чаты.
  if (!tenant || !(await isModuleEnabled(tenant.id, "clientsEnabled"))) {
    await sendChatMessage(chatId, BOT_STRINGS[lang].linkInvalid).catch(() => {});
    return;
  }

  const existingLink = await prisma.clientTelegramLink.findUnique({
    where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
  });
  if (existingLink) {
    const wallet = await findWalletByPhone(tenant.id, existingLink.phone);
    if (wallet) {
      await sendChatMessageWithMenu(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
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

// Клиент нажал кнопку "Поделиться номером". Telegram Bot API НЕ гарантирует,
// что присланный contact принадлежит отправителю (Contact.user_id как раз
// существует для этой проверки на стороне бота — она молча отсутствовала:
// найдено при финальном аудите 2026-07-25). Без сверки contact.user_id ===
// from.id пользователь мог вместо нажатия кнопки "Поделиться номером"
// приложить ЧУЖУЮ контакт-карточку из телефонной книги (обычное вложение,
// не отличить от настоящего шаринга иначе) и получить баланс/историю/заказы
// того человека — на любом тенанте платформы, где у этого номера есть
// кошелёк (generic-флоу ниже ищет сразу по всем тенантам). Сверяем и
// отклоняем несовпадение, вместо того чтобы доверять номеру напрямую.
async function handleContact(message: {
  chat: { id: number };
  contact?: { phone_number: string; user_id?: number };
  from?: { id?: number; language_code?: string };
}) {
  const chatId = String(message.chat.id);
  const contact = message.contact;
  if (!contact) return;
  const lang = pickBotLang(message.from?.language_code);

  if (message.from?.id != null && contact.user_id != null && contact.user_id !== message.from.id) {
    const s = BOT_STRINGS[lang];
    await sendChatMessage(chatId, s.contactMismatch).catch(() => {});
    return;
  }

  const session = await prisma.clientBotSession.findUnique({ where: { chatId } });
  if (!session) return; // контакт прислан не в ответ на наш запрос — игнорируем

  const pendingTenantId = session.pendingTenantId;
  await prisma.clientBotSession.update({ where: { chatId }, data: { pendingTenantId: null } });

  const phone = normalizePhone(contact.phone_number);
  const s = BOT_STRINGS[lang];

  if (pendingTenantId) {
    // Scoped-флоу — конкретная ссылка тенанта, ищем только там.
    const tenant = await prisma.tenant.findUnique({ where: { id: pendingTenantId }, select: { id: true, name: true, currency: true } });
    if (!tenant || !(await isModuleEnabled(tenant.id, "clientsEnabled"))) return;
    const wallet = await findWalletByPhone(tenant.id, phone);
    if (!wallet) {
      await sendChatMessage(chatId, s.notFoundTenant(contact.phone_number, tenant.name)).catch(() => {});
      return;
    }
    await prisma.clientTelegramLink.upsert({
      where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
      create: { tenantId: tenant.id, chatId, phone, language: lang },
      update: { phone, language: lang },
    });
    await sendChatMessageWithMenu(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
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
    if (!tenant || !(await isModuleEnabled(tenant.id, "clientsEnabled"))) continue;
    await prisma.clientTelegramLink.upsert({
      where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
      create: { tenantId: tenant.id, chatId, phone, language: lang },
      update: { phone, language: lang },
    });
    await sendChatMessageWithMenu(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
  }
}

const HISTORY_LIMIT = 5;

// Баланс + последние операции + непогашенные заказы билетов — всё одним
// сообщением (запрос пользователя 2026-07-22: клиент не должен разбираться в
// отдельных командах, один тап по кнопке даёт полную картину сразу).
async function buildClientReport(
  tenant: { id: string; name: string; currency: string | null },
  wallet: { id: string; name: string | null; balance: unknown },
  lang: BotLang
): Promise<string> {
  const s = BOT_STRINGS[lang];
  const currency = tenant.currency as CurrencyCode | null;
  const lines = [
    greetingLine(wallet.name, s),
    `${s.yourBalance}: <b>${formatMoneyWithCurrency(Number(wallet.balance), "ru", currency)}</b>`,
  ];

  // Обогащённая история (запрос пользователя 2026-07-23: раньше строка была
  // просто "22.07  −150 ₽" без объяснения, за что) — подключаем все связи,
  // через которые AbonementTransaction ссылается на "что именно" (план
  // пополнения / актив-пуск / товар / заказ билетов), берём первое
  // непустое имя. Для "Счётчиков" (прямое списание на актив без Launch) имя
  // берём из asset напрямую — единственный тип операции, где Launch нет
  // вообще (см. spendWalletForZone в abonement.ts).
  const history = await prisma.abonementTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { occurredAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      type: true,
      amount: true,
      occurredAt: true,
      abonement: { select: { name: true } },
      launch: { select: { asset: { select: { name: true } }, zone: { select: { name: true } } } },
      goodsSale: { select: { goods: { select: { name: true } } } },
      ticketOrder: { select: { number: true } },
      asset: { select: { name: true } },
    },
  });
  if (history.length > 0) {
    lines.push("", `<b>${s.recentOps}:</b>`);
    for (const h of history) {
      const sign = h.type === "spend" ? "−" : "+";
      const date = h.occurredAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
      const typeLabel =
        h.type === "spend" ? s.typeSpend : h.type === "refund" ? s.typeRefund : h.type === "adjustment" ? s.typeAdjustment : s.typeTopup;
      const detail =
        h.abonement?.name ??
        h.launch?.asset?.name ??
        h.launch?.zone.name ??
        h.goodsSale?.goods.name ??
        (h.ticketOrder ? `${s.ticketOrderPrefix} №${h.ticketOrder.number}` : null) ??
        h.asset?.name ??
        null;
      const label = detail ? `${typeLabel} · ${detail}` : typeLabel;
      lines.push(`${date}  ${label}  ${sign}${formatMoneyWithCurrency(Number(h.amount), "ru", currency)}`);
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
    // /balance тут намеренно НЕ обрабатывается (запрос пользователя
    // 2026-07-24: "не надо, чтобы в общей группе Сотрудники могли узнавать
    // баланс клиента") — только /kassa. Раньше был просмотр/выбор клиента
    // прямо в группе, убран целиком, не просто скрыт за флагом.
    if (/^\/kassa(?:@\w+)?/.test(text)) {
      await handleKassaCommand(chatId, channel.tenantId);
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
  } else if (/^\/services(?:@\w+)?/.test(text)) {
    await handleServicesCommand(chatId, pickBotLang(message.from?.language_code));
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
    if (!tenant || !(await isModuleEnabled(tenant.id, "clientsEnabled"))) continue;
    const wallet = await findWalletByPhone(tenant.id, link.phone);
    if (!wallet) continue;
    await sendChatMessageWithMenu(chatId, await buildClientReport(tenant, wallet, lang)).catch(() => {});
  }
}

const SERVICES_TENANT_CALLBACK_PREFIX = "svct:";
const SERVICES_POINT_CALLBACK_PREFIX = "svcp:";

// Статический список активных зон/активов (запрос пользователя 2026-07-24:
// "клиенты как подписчики" — /services тоже держится на уже существующей
// привязке, отдельного флоу верификации под это заводить не стали, ровно та
// же причина, что у /balance без ссылки: без привязки бот не знает, какой
// именно тенант имеется в виду, раз бот один на всю платформу). Слово "зона"
// в тексте НИКОГДА не используется — это внутренний термин проекта, клиенту
// показываются только имена, которые задал сам Владелец.
async function handleServicesCommand(chatId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  const links = await prisma.clientTelegramLink.findMany({ where: { chatId }, select: { tenantId: true } });
  const tenantIds = [...new Set(links.map((l) => l.tenantId))];

  if (tenantIds.length === 0) {
    await sendChatMessage(chatId, s.servicesNotLinkedHint).catch(() => {});
    return;
  }
  if (tenantIds.length === 1) {
    await sendServicesForTenant(chatId, tenantIds[0], lang);
    return;
  }

  const tenants = await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } });
  const buttons = tenants.map((t) => ({ text: t.name, callbackData: `${SERVICES_TENANT_CALLBACK_PREFIX}${t.id}` }));
  await sendInlineKeyboard(chatId, s.chooseTenantPrompt, buttons).catch(() => {});
}

async function sendServicesForTenant(chatId: string, tenantId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  // Только активные (запрос пользователя 2026-07-13: сезонная деактивация) —
  // тот же флаг, что уже скрывает точку с публичного лендинга.
  const points = await prisma.point.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (points.length === 0) {
    await sendChatMessage(chatId, s.noServicesFound).catch(() => {});
    return;
  }
  if (points.length === 1) {
    await sendServicesForPoint(chatId, points[0].id, lang);
    return;
  }

  const buttons = points.map((p) => ({ text: p.name, callbackData: `${SERVICES_POINT_CALLBACK_PREFIX}${p.id}` }));
  await sendInlineKeyboard(chatId, s.choosePointPrompt, buttons).catch(() => {});
}

async function sendServicesForPoint(chatId: string, pointId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  const point = await prisma.point.findUnique({
    where: { id: pointId },
    select: {
      name: true,
      tenant: { select: { slug: true, landingEnabled: true } },
      zones: {
        where: { active: true },
        orderBy: { createdAt: "asc" },
        select: {
          name: true,
          telegramEmoji: true,
          accountingMode: true,
          // Билеты — единственный режим, где одна "витрина" может продавать
          // сразу несколько разных аттракционов под одним именем (запрос
          // пользователя 2026-07-24: "для билетов имеет смысл показывать
          // активы") — у остальных режимов имя самой витрины уже и есть
          // конкретный аттракцион, перечислять активы там избыточно.
          assets: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { name: true } },
        },
      },
    },
  });
  if (!point) return;

  const lines = [`<b>${point.name}</b>`, ""];
  if (point.zones.length === 0) {
    lines.push(s.noServicesFound);
  } else {
    for (const zone of point.zones) {
      const emoji = zone.telegramEmoji ?? "🏁";
      if (zone.accountingMode === "tickets" && zone.assets.length > 0) {
        lines.push(`${emoji} ${zone.name}:`);
        for (const asset of zone.assets) {
          lines.push(`  • ${asset.name}`);
        }
      } else {
        lines.push(`${emoji} ${zone.name}`);
      }
    }
  }
  const text = lines.join("\n");

  // Ссылка на лендинг — только если Владелец не отключил модуль (запрос
  // пользователя 2026-07-24: "надо учесть, чтобы он был включён у Владельца"),
  // без неё просто обычное сообщение без кнопок.
  if (point.tenant.landingEnabled && point.tenant.slug) {
    const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
    await sendInlineKeyboard(chatId, text, [{ text: s.openLandingButton, url: `${siteUrl}/s/${point.tenant.slug}` }]).catch(() => {});
  } else {
    await sendChatMessage(chatId, text).catch(() => {});
  }
}

// Наличные — весь журнал без периода (getPointCashBalance внутри
// buildDailyCashSummaryData, обнуляется только инкассацией), безнал/баланс —
// ЗА СЕГОДНЯ (запрос пользователя 2026-07-25: у безнала/баланса нет
// собственной "инкассации", которая бы их когда-либо обнуляла — сумма за всю
// историю тенанта была бы бесполезно огромной для быстрой проверки в чате).
// Переиспользует buildDailyCashSummaryData — те же цифры, что уже видны
// Владельцу в автосводке "Касса за день" (docs/spec/telegram-summaries.md),
// не отдельный расчёт с риском разъехаться.
async function handleKassaCommand(chatId: string, tenantId: string) {
  const [tenant, points] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true, businessDayBoundary: true, timezone: true } }),
    prisma.point.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!tenant || points.length === 0) {
    await sendChatMessage(chatId, "Нет ни одной точки").catch(() => {});
    return;
  }

  const currency = tenant.currency as CurrencyCode | null;
  const businessDayBoundary = tenant.businessDayBoundary ?? DAILY_CASH_SUMMARY_DEFAULTS.businessDayBoundary;
  const timezone = tenant.timezone ?? "UTC";
  const bounds = getBusinessDayBounds(businessDayBoundary, new Date(), timezone);
  const data = await Promise.all(points.map((p) => buildDailyCashSummaryData(p.id, bounds, false)));

  const money = (n: number) => formatMoneyWithCurrency(n, "ru", currency);
  const totals = { cash: 0, mobile: 0, abonement: 0 };
  const lines = ["<b>Касса сейчас:</b>"];

  points.forEach((p, i) => {
    const d = data[i];
    if (!d) return;
    totals.cash += d.cashOnHand;
    totals.mobile += d.mobileAmount;
    totals.abonement += d.abonementAmount;

    if (points.length > 1) lines.push("", `<b>${p.name}</b>`);
    lines.push(`💵 Наличные: ${money(d.cashOnHand)}`);
    if (d.mobileAmount > 0) lines.push(`💳 Безнал: ${money(d.mobileAmount)}`);
    if (d.abonementAmount > 0) lines.push(`👨🏻‍💼 Баланс: ${money(d.abonementAmount)}`);
  });

  if (points.length > 1) {
    lines.push("", "<b>Итого:</b>");
    lines.push(`💵 Наличные: ${money(totals.cash)}`);
    if (totals.mobile > 0) lines.push(`💳 Безналичные сегодня: ${money(totals.mobile)}`);
    if (totals.abonement > 0) lines.push(`👨🏻‍💼 Баланс сегодня: ${money(totals.abonement)}`);
  }

  await sendChatMessage(chatId, lines.join("\n")).catch(() => {});
}

async function handleCallbackQuery(callbackQuery: {
  id: string;
  data?: string;
  message?: { chat: { id: number } };
  from?: { language_code?: string };
}) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message ? String(callbackQuery.message.chat.id) : null;
  await answerCallbackQuery(callbackQuery.id);
  if (!data || !chatId) return;

  // Кнопки выбора тенанта/точки у /services (личный чат клиента) — публичная
  // информация (список услуг), доп. проверка принадлежности тут не нужна.
  const lang = pickBotLang(callbackQuery.from?.language_code);
  if (data.startsWith(SERVICES_TENANT_CALLBACK_PREFIX)) {
    await sendServicesForTenant(chatId, data.slice(SERVICES_TENANT_CALLBACK_PREFIX.length), lang);
  } else if (data.startsWith(SERVICES_POINT_CALLBACK_PREFIX)) {
    await sendServicesForPoint(chatId, data.slice(SERVICES_POINT_CALLBACK_PREFIX.length), lang);
  }
}
