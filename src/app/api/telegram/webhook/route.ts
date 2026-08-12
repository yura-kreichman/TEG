import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  sendChatMessage,
  sendChatMessageWithMenu,
  sendContactRequest,
  sendInlineKeyboard,
  answerCallbackQuery,
  getTenantPublicGroup,
  fetchChatInviteLink,
  isChatMember,
  getClientBalanceDeepLink,
  deleteChatMessage,
  setStaffGroupCommands,
  CLIENT_START_PREFIX,
  escapeHtml,
} from "@/lib/telegram-bot";
import {
  describeAbonementTransactionSource,
  findWalletByPhone,
  findWalletCandidatesByKey,
  isSuffixMatch,
  normalizePhone,
  phoneMatchKey,
} from "@/lib/abonement";
import { formatMoneyWithCurrency } from "@/lib/format";
import type { CurrencyCode } from "@/lib/currency";
import { getBusinessDayBounds } from "@/lib/business-day";
import { buildDailyCashSummaryData } from "@/lib/summary-channels/daily-cash-data";
import { DAILY_CASH_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { pickBotLang, BOT_STRINGS, greetingLine, type BotStringSet } from "@/lib/telegram-client-i18n";
import type { Locale } from "@/lib/locales";
import { isLocale } from "@/lib/locales";
import { timingSafeEqualStrings } from "@/lib/timing-safe-equal";
import { getSystemSettingsConfig, patchSystemSettingsConfig } from "@/lib/system-settings";
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
    } else if (update.message?.new_chat_members) {
      await handleNewChatMembers(update.message);
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

  // Группа самой платформы (запрос пользователя 2026-08-10) — отдельной
  // веткой целиком: у такого кода нет тенанта, а chatId сохраняется не в
  // таблицу тенанта, а в системные настройки. Весь код ниже завязан на
  // tenantId и для этого случая неприменим.
  if (bindCode.purpose === "platform") {
    if (message.chat.type === "private") {
      await sendChatMessage(chatId, "Отправьте этот код в вашу группу, не сюда — добавьте бота в группу и напишите код там.").catch(() => {});
      return;
    }

    // Тот же CAS, что и ниже: Telegram доставляет вебхук "at least once", и
    // без него дубль апдейта подключал бы чат дважды.
    const claimed = await prisma.telegramBindCode.updateMany({
      where: { id: bindCode.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const { adminNotifications } = await getSystemSettingsConfig();
    const previousChatId = adminNotifications.chatId;
    await patchSystemSettingsConfig({
      adminNotifications: { ...adminNotifications, chatId, chatTitle: chatTitle ?? "" },
    });

    if (previousChatId && previousChatId !== chatId) {
      await sendChatMessage(previousChatId, "Уведомления платформы переведены в другой чат").catch(() => {});
    }
    await sendChatMessage(chatId, "✅ Уведомления RentOS подключены к этому чату").catch(() => {});
    return;
  }

  // Дальше — только привязки тенанта, у них tenantId есть всегда (null бывает
  // ровно у "platform", обработанного выше).
  const tenantId = bindCode.tenantId;
  if (!tenantId) return;

  // Публичная группа клиентов (запрос пользователя 2026-07-24) обязана быть
  // настоящей группой, не личным чатом с ботом — deep-link "?startgroup="
  // всегда открывает выбор группы, но владелец теоретически мог отправить
  // код руками боту напрямую по ошибке. Код НЕ гасим (usedAt не трогаем) —
  // пусть отправит его ещё раз, уже в саму группу.
  if (bindCode.purpose === "public_group" && message.chat.type === "private") {
    await sendChatMessage(chatId, "Отправьте этот код в вашу группу, не сюда — добавьте бота в группу и напишите код там.").catch(() => {});
    return;
  }

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

    if (bindCode.purpose === "public_group") {
      // Singleton на тенанта (TenantPublicGroup.tenantId unique) — истории
      // прошлых чатов нет по конструкции, просто перезаписываем; старый
      // chatId читаем ДО апдейта, только чтобы было куда послать "переехали".
      const existingGroup = await tx.tenantPublicGroup.findUnique({ where: { tenantId: tenantId } });
      await tx.tenantPublicGroup.upsert({
        where: { tenantId: tenantId },
        create: { tenantId: tenantId, chatId, chatTitle, chatStatus: "active" },
        update: { chatId, chatTitle, chatStatus: "active" },
      });
      return existingGroup?.chatId && existingGroup.chatId !== chatId ? existingGroup.chatId : null;
    }

    // Пересвязка: если уже была активная привязка на другой чат — деактивируем
    // старую запись, а не перезаписываем (сохраняем историю, см. схему).
    const existing = await tx.tenantSummaryChannel.findFirst({
      where: { tenantId: tenantId, channelType: "telegram", pointId: null },
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

    if (existing && existing.chatId === null) {
      // Запись уже была — Владелец настроил тумблер ДО подключения (запрос
      // пользователя 2026-07-24) — просто проставляем chatId в неё же, не
      // создаём новую и не трогаем уже выбранный enabled.
      await tx.tenantSummaryChannel.update({
        where: { id: existing.id },
        data: { chatId, chatTitle, chatStatus: "active" },
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
        tenantId: tenantId,
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
    const oldChatText = bindCode.purpose === "public_group" ? "Группа анонсов теперь в другом чате" : "Сводки переведены в другой чат";
    await sendChatMessage(notifyOldChatId, oldChatText).catch(() => {});
  }
  await sendChatMessage(chatId, "✅ RentOS подключён к этому чату").catch(() => {});

  // Подсказка "/kassa" — только в этом конкретном рабочем чате (запрос
  // пользователя 2026-07-25), не в клиентской группе (см. setStaffGroupCommands).
  if (bindCode.purpose === "summary") {
    await setStaffGroupCommands(chatId);
  }

  // Автоматическая ссылка-приглашение (запрос пользователя 2026-07-24) —
  // пробуем сразу при привязке; сработает, только если бота добавили в
  // группу админом с правом приглашать по ссылке. Не получилось — не беда,
  // страница настроек предложит вставить ссылку вручную, как и раньше.
  if (bindCode.purpose === "public_group") {
    const link = await fetchChatInviteLink(chatId);
    if (link) {
      await prisma.tenantPublicGroup.update({ where: { tenantId: tenantId }, data: { inviteLink: link } }).catch(() => {});
    }
  }
}

async function handleMyChatMember(update: {
  chat: { id: number; type: string };
  new_chat_member: { status: string };
}) {
  const status = update.new_chat_member?.status;
  if (status !== "left" && status !== "kicked") return;

  const chatId = String(update.chat.id);

  // Личный чат клиента с ботом — реальный баг, найден пользователем
  // 2026-07-25: клиент заблокировал/удалил бота, а синий значок "подключён
  // Telegram" у Владельца/Сотрудника (abonement-topup-flow.tsx,
  // foundHasTelegram) оставался навсегда, потому что ClientTelegramLink
  // никто не удалял. Telegram шлёт my_chat_member и для приватных чатов —
  // "у бота изменился статус в этом чате" (kicked = заблокировал) — та же
  // механика, что уже обрабатывает статус бота в группах ниже, просто для
  // private нужна другая таблица. При повторном /start ссылка пересоздаётся
  // сама (handleClientStart/handleContact делают upsert), поэтому просто
  // удаляем — не помечаем неактивной.
  if (update.chat.type === "private") {
    await prisma.clientTelegramLink.deleteMany({ where: { chatId } });
    return;
  }

  await prisma.tenantSummaryChannel.updateMany({
    where: { channelType: "telegram", chatId },
    data: { chatStatus: "inactive" },
  });
  // Публичная группа — тот же chatId не может совпасть с рабочим чатом
  // (разные Telegram-группы), поэтому оба updateMany безопасно идут подряд,
  // затронет только реально совпавшую таблицу.
  await prisma.tenantPublicGroup.updateMany({
    where: { chatId },
    data: { chatStatus: "inactive" },
  });
}

// Приветствие новых участников публичной группы клиентов (запрос
// пользователя 2026-07-25: "стимулировать, чтобы сами себя добавляли" —
// обсуждение свелось к двум рычагам: это, и разовая рассылка в группу для
// уже состоящих — см. .../public-group/telegram/invite-registration/route.ts).
// Telegram шлёт служебное сообщение "X вступил в группу" даже без прав
// администратора у бота — тем самым НЕ ограничение, что бот не может писать
// в личку первым: сама группа уже видна боту. Реагируем только если группа
// реально включена (group.enabled — тот же тумблер, что и у прочих исходящих
// анонсов, см. announceNewZoneOrPointOrAsset/sendJoinForTenant), и только на
// НАСТОЯЩИХ пользователей (is_bot исключает случай, когда кто-то добавил
// СТОРОННЕГО бота в ту же группу).
async function handleNewChatMembers(message: {
  chat: { id: number; type: string };
  new_chat_members: { id: number; is_bot: boolean; first_name: string }[];
}) {
  const chatId = String(message.chat.id);
  const group = await prisma.tenantPublicGroup.findFirst({
    where: { chatId, chatStatus: "active", enabled: true },
    select: { tenantId: true, welcomeNewMembers: true },
  });
  if (!group) return;
  // Приветствие можно выключить, не отвязывая группу и не выключая рассылку
  // целиком (запрос владельца 2026-08-08) — тумблер отдельный от enabled.
  if (!group.welcomeNewMembers) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: group.tenantId }, select: { slug: true, locale: true } });
  if (!tenant?.slug) return;
  const deepLink = await getClientBalanceDeepLink(tenant.slug);
  if (!deepLink) return;

  // Групповое сообщение видно сразу всем участникам разных языков — берём
  // ЯЗЫК ТЕНАНТА (Tenant.locale), не message.from.language_code отдельного
  // вступившего: у одной группы один язык на всех, персонализировать нечем.
  const lang: BotLang = isLocale(tenant.locale) ? tenant.locale : "ru";
  const s = BOT_STRINGS[lang];

  for (const member of message.new_chat_members) {
    if (member.is_bot) continue;
    // escapeHtml (аудит 2026-07-27) — first_name это свободный ввод самого
    // присоединившегося пользователя, единственное поле во всём файле,
    // полностью подконтрольное анонимному внешнему человеку без всякого
    // сотрудничества владельца тенанта — раньше уходило в HTML-сообщение
    // необработанным.
    const text = `${s.groupWelcomeGreeting(escapeHtml(member.first_name))}\n${s.groupWelcomeBody}`;
    const result = await sendInlineKeyboard(chatId, text, [{ text: s.groupWelcomeButton, url: deepLink }]).catch(() => null);
    // Сохраняем id сообщения — удалится, когда человек реально перейдёт по
    // кнопке в бота (запрос пользователя 2026-07-25: "чтобы не засорять
    // группу"), см. handleClientStart. memberChatId — тот же id, которым
    // Telegram потом придёт /start в личке этого человека (совпадение
    // user.id и private chat.id, см. комментарий у isChatMember).
    if (result?.ok && result.messageId) {
      const memberChatId = String(member.id);
      await prisma.clientBotSession
        .upsert({
          where: { chatId: memberChatId },
          create: { chatId: memberChatId, pendingWelcomeGroupChatId: chatId, pendingWelcomeMessageId: result.messageId },
          update: { pendingWelcomeGroupChatId: chatId, pendingWelcomeMessageId: result.messageId },
        })
        .catch(() => {});
    }
  }
}

// Удаляет приветственное сообщение в группе клиентов, если оно ещё ждёт
// этого перехода (см. handleNewChatMembers) — best-effort, молча ничего не
// делает, если pending-полей нет (обычный /start без приветствия) или
// удаление в Telegram не удалось (сообщение уже стёрли вручную и т.п.).
async function cleanupPendingWelcomeMessage(chatId: string): Promise<void> {
  const session = await prisma.clientBotSession.findUnique({ where: { chatId } });
  if (!session?.pendingWelcomeGroupChatId || !session.pendingWelcomeMessageId) return;
  await deleteChatMessage(session.pendingWelcomeGroupChatId, session.pendingWelcomeMessageId);
  await prisma.clientBotSession
    .update({ where: { chatId }, data: { pendingWelcomeGroupChatId: null, pendingWelcomeMessageId: null } })
    .catch(() => {});
}

// Клиент открыл ссылку t.me/<bot>?start=CLIENT-<slug> — либо у него уже есть
// подтверждённая привязка для этого тенанта (быстрый путь: сразу баланс, без
// повторного запроса контакта), либо просим поделиться номером.
async function handleClientStart(chatId: string, tenantSlug: string, lang: BotLang) {
  // Приветствие в группе клиентов ждало именно этого перехода (запрос
  // пользователя 2026-07-25: "чтобы не засорять группу") — удаляем и чистим
  // стейт независимо от исхода самого /start ниже (модуль мог быть выключен
  // и т.п. — приветствие всё равно больше не нужно, раз человек уже перешёл).
  await cleanupPendingWelcomeMessage(chatId);

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
      await sendClientReportWithMenu(chatId, tenant, wallet, lang);
      return;
    }
    // Кошелёк с тех пор удалили/номер сменился — привязка устарела, спросим
    // контакт заново ниже, а не покажем ошибку.
  }

  await promptContactShare(chatId, tenant.id, escapeHtml(tenant.name), lang);
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

  // contact.user_id ОБЯЗАН присутствовать и совпадать (аудит 2026-07-27,
  // реальная межтенантная утечка ПДн — второй раунд того же класса бага,
  // что уже чинили 2026-07-25). Прежняя проверка пропускала сверку, если
  // contact.user_id вообще отсутствовал (`!= null` было условием ВХОДА в
  // проверку, а не обязательным требованием) — Telegram документирует это
  // поле как опциональное, и оно РЕАЛЬНО отсутствует, когда пользователь
  // прикладывает контакт, вручную сохранённый в телефонной книге и не
  // привязанный к Telegram-аккаунту (в отличие от родной кнопки "Поделиться
  // номером", которая всегда заполняет user_id для контакта самого
  // отправителя). Значит нажатие кнопки "Поделиться номером" и выбор ЧУЖОГО
  // локального контакта из телефонной книги давали неотличимый снаружи
  // результат: contact без user_id — и старая проверка это молча пропускала,
  // позволяя узнать баланс/историю чужого клиента по одному known номеру.
  // Теперь user_id обязателен: его отсутствие тоже отклоняется, не только
  // явное несовпадение.
  if (contact.user_id == null || contact.user_id !== message.from?.id) {
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
    // Три уровня, а не один (решение пользователя 2026-08-12) — оператор мог
    // сохранить тот же номер короче: "77795928" или "077795928" вместо
    // "37377795928", который отдаёт Telegram.
    //
    // 1. Точное совпадение — связываем, как было всегда.
    // 2. Сохранённое является ОКОНЧАНИЕМ проверенного и кандидат ровно один —
    //    почти наверняка тот же человек: связываем и заодно канонизируем
    //    номер. Данные Telegram проверены (contact.user_id сверен выше), они
    //    надёжнее набранного руками, поэтому запись чинится сама.
    // 3. Совпал только хвост, но окончанием не является, либо кандидатов
    //    несколько — НЕ связываем. Здесь подтверждать некому, а ошибка стоит
    //    не дубликата, а показа чужого баланса. Заводим отдельный кошелёк
    //    (offerRegistration) — это чинится оператором, утечка нет.
    const wallet = await findWalletByPhone(tenant.id, phone);
    if (!wallet) {
      const candidates = await findWalletCandidatesByKey(tenant.id, phone);
      const suffixMatches = candidates.filter((c) => isSuffixMatch(c.phone, phone));
      if (suffixMatches.length === 1) {
        const matched = suffixMatches[0]!;
        // Канонизация номера может упереться в уже существующий кошелёк с
        // этим же номером (гонка либо ручной дубликат) — тогда просто не
        // трогаем запись и связываемся по тому, что есть: связь важнее
        // косметики, а падать на уникальном индексе здесь нельзя.
        const canonical = await prisma.abonementWallet
          .update({ where: { id: matched.id }, data: { phone, phoneKey: phoneMatchKey(phone) } })
          .catch(() => matched);
        await prisma.clientTelegramLink.upsert({
          where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
          create: { tenantId: tenant.id, chatId, phone: canonical.phone, language: lang },
          update: { phone: canonical.phone, language: lang },
        });
        await sendClientReportWithMenu(chatId, tenant, canonical, lang);
        return;
      }
      await offerRegistration(chatId, tenant, phone, contact.phone_number, lang);
      return;
    }
    await prisma.clientTelegramLink.upsert({
      where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
      create: { tenantId: tenant.id, chatId, phone, language: lang },
      update: { phone, language: lang },
    });
    await sendClientReportWithMenu(chatId, tenant, wallet, lang);
    return;
  }

  // Generic-флоу — тенант неизвестен заранее (голый /start, ссылка не
  // использовалась), ищем кошелёк с этим номером СРАЗУ по всем тенантам
  // платформы: один и тот же человек вполне может быть клиентом нескольких
  // разных прокатов на RentOS, отправляем отчёт по каждому найденному.
  //
  // ЗДЕСЬ ТОЛЬКО ТОЧНОЕ СОВПАДЕНИЕ (решение пользователя 2026-08-12).
  // Нестрогое сопоставление по хвосту, разрешённое в scoped-флоу выше,
  // опирается на то, что пространство ограничено одним тенантом. Тут
  // пространство — все клиенты всех прокатов платформы, и совпадение восьми
  // последних цифр перестаёт быть редкостью: включить его значило бы раздавать
  // чужие балансы. Человек с коротко сохранённым номером просто зайдёт по
  // ссылке своего проката — там сработает scoped-путь.
  const wallets = await prisma.abonementWallet.findMany({ where: { phone } });
  if (wallets.length === 0) {
    // escapeHtml — защита в глубину, см. комментарий у offerRegistration.
    await sendChatMessage(chatId, s.notFoundGeneric(escapeHtml(contact.phone_number))).catch(() => {});
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
    await sendClientReportWithMenu(chatId, tenant, wallet, lang);
  }
}

// Саморегистрация клиента (запрос пользователя 2026-07-25: "чтобы сами себя
// добавляли в базу Клиентов Владельца") — только в scoped-флоу (известен
// tenant), НЕ в generic (тенант не определён вовсе — регистрировать
// человека неизвестно куда бессмысленно). Телефон уже проверен Telegram'ом
// (contact.user_id) на шаге handleContact — при тапе "Регистрация" повторно
// его не спрашиваем, только имя. Тенант+телефон живут в ClientBotSession до
// тапа по кнопке.
async function offerRegistration(
  chatId: string,
  tenant: { id: string; name: string; currency: string | null },
  phone: string,
  rawPhone: string,
  lang: BotLang
): Promise<void> {
  const s = BOT_STRINGS[lang];
  await prisma.clientBotSession.update({
    where: { chatId },
    data: { pendingRegistrationTenantId: tenant.id, pendingRegistrationPhone: phone, awaitingRegistrationName: false },
  });
  const [showJoin, showBonus] = await Promise.all([tenantHasActiveGroup(tenant.id, chatId), tenantHasAbonementsToSell(tenant.id)]);
  // escapeHtml(rawPhone) — защита в глубину (аудит 2026-07-27): основной
  // вектор (чужой контакт без совпадающего user_id) уже отсекается раньше, в
  // handleContact, но phone_number формально произвольная строка от клиента
  // Telegram, дешевле экранировать и здесь, не полагаясь только на то, что
  // Bot API всегда шлёт цифры.
  const text = `${s.notFoundTenant(escapeHtml(rawPhone), escapeHtml(tenant.name))}\n\n${s.tapRegisterHint}`;
  await sendChatMessageWithMenu(chatId, text, s, { showRegister: true, showJoin, showBonus }).catch(() => {});
}

// Тап по кнопке "📝 Регистрация" — переводит в режим "жду имя". Стейл-стейт
// (кнопка нажата из старого сообщения, например через день, когда pending*
// уже не сохранился/сброшен) — просто просим поделиться номером заново,
// без ошибки.
async function handleRegisterTap(chatId: string, lang: BotLang): Promise<void> {
  const s = BOT_STRINGS[lang];
  const session = await prisma.clientBotSession.findUnique({ where: { chatId } });
  if (!session?.pendingRegistrationTenantId || !session.pendingRegistrationPhone) {
    await promptContactShare(chatId, null, undefined, lang);
    return;
  }
  await prisma.clientBotSession.update({ where: { chatId }, data: { awaitingRegistrationName: true } });
  await sendChatMessage(chatId, s.askNamePrompt).catch(() => {});
}

// Следующее произвольное сообщение после тапа "Регистрация" — трактуется как
// имя (запрос пользователя 2026-07-25: "пусть имя будет обязательным, без
// пропустить"). Пустое — просим повторить, стейт не сбрасываем.
async function handleRegistrationName(chatId: string, tenantId: string, phone: string, rawName: string, lang: BotLang): Promise<void> {
  const s = BOT_STRINGS[lang];
  const name = rawName.trim();
  if (!name) {
    await sendChatMessage(chatId, s.nameRequiredHint).catch(() => {});
    return;
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, currency: true } });
  if (!tenant || !(await isModuleEnabled(tenant.id, "clientsEnabled"))) {
    await prisma.clientBotSession.update({
      where: { chatId },
      data: { pendingRegistrationTenantId: null, pendingRegistrationPhone: null, awaitingRegistrationName: false },
    });
    return;
  }

  // Клиент мог успеть появиться в базе за время между "не найден" и вводом
  // имени (например, Сотрудник продал ему абонемент лично на точке, пока он
  // печатал имя) — перепроверяем перед созданием, чтобы не задвоить.
  let wallet = await findWalletByPhone(tenant.id, phone);
  if (!wallet) {
    try {
      wallet = await prisma.abonementWallet.create({
        data: { tenantId: tenant.id, phone, phoneKey: phoneMatchKey(phone), name },
      });
    } catch {
      // Параллельная доставка того же апдейта (Telegram "at least once")
      // могла создать кошелёк первой — просто забираем то, что уже создано.
      wallet = await findWalletByPhone(tenant.id, phone);
      if (!wallet) return;
    }
  }

  await prisma.clientTelegramLink.upsert({
    where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
    create: { tenantId: tenant.id, chatId, phone, language: lang },
    update: { phone, language: lang },
  });
  await prisma.clientBotSession.update({
    where: { chatId },
    data: { pendingRegistrationTenantId: null, pendingRegistrationPhone: null, awaitingRegistrationName: false },
  });

  // Приветствие + отчёт + (если настроено) список абонементов и где купить
  // (запрос пользователя 2026-07-25: "проверить, что абонементы созданы и
  // есть кто их продаёт и где") — одним сообщением, не спамим тремя подряд.
  const [report, abonementsInfo, showJoin, showBonus] = await Promise.all([
    buildClientReport(chatId, tenant, wallet, lang),
    buildAbonementsInfo(tenant, lang),
    tenantHasActiveGroup(tenant.id, chatId),
    tenantHasAbonementsToSell(tenant.id),
  ]);
  const parts = [s.registeredGreeting(escapeHtml(tenant.name)), report];
  if (abonementsInfo) parts.push(abonementsInfo);
  await sendChatMessageWithMenu(chatId, parts.join("\n\n"), s, { showJoin, showBonus }).catch(() => {});
}

// Показывать ли кнопку "Будем вместе" в постоянном меню — та же проверка,
// что уже применяет sendJoinForTenant при самом тапе (запрос пользователя
// 2026-07-25: "нельзя эту кнопку и команду вообще скрыть, если группа не
// подключена" — раньше кнопка показывалась всегда, тап на неотключённой/
// неподключённой группе вёл только к "Группа пока не подключена"; тот же
// день, следом: "а если Клиент уже в группе?" — если бот реально подключён
// к группе (group.chatId), дополнительно проверяем членство САМОГО этого
// клиента через isChatMember; clientChatId клиента — тот же chatId личного
// чата с ботом (см. комментарий у isChatMember про совпадение с user_id).
// null от isChatMember ("не удалось проверить") — не считаем за "уже
// состоит", ведём себя как раньше, кнопку показываем.
async function tenantHasActiveGroup(tenantId: string, clientChatId: string): Promise<boolean> {
  const group = await getTenantPublicGroup(tenantId);
  if (!group?.inviteLink || !group.enabled) return false;
  if (group.chatId) {
    const isMember = await isChatMember(group.chatId, clientChatId);
    if (isMember) return false;
  }
  return true;
}

// Показывать ли кнопку "🎁 Абонементы" — есть ли вообще что показать (запрос
// пользователя 2026-07-25: "проверить, что абонементы созданы и есть кто их
// продаёт и где"). Продажа — только Сотрудник на точке (Владелец продавать
// планы не может, docs/spec: решение 2026-07-18), конкретного продавца
// указать нельзя, поэтому условие — активная точка вообще, без привязки к
// сотруднику.
async function tenantHasAbonementsToSell(tenantId: string): Promise<boolean> {
  const [planCount, pointCount] = await Promise.all([
    prisma.abonement.count({ where: { tenantId, deletedAt: null } }),
    prisma.point.count({ where: { tenantId, active: true } }),
  ]);
  return planCount > 0 && pointCount > 0;
}

// Список планов + где купить (запрос пользователя 2026-07-25) — null, если
// нечего показать (оба условия tenantHasAbonementsToSell), НЕ "абонементов
// пока нет" текстом — чтобы не выглядело недоработкой владельца. Общий
// строитель для /bonus и приветствия после саморегистрации.
async function buildAbonementsInfo(tenant: { id: string; currency: string | null }, lang: BotLang): Promise<string | null> {
  const s = BOT_STRINGS[lang];
  const [plans, points] = await Promise.all([
    prisma.abonement.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
      orderBy: { order: "asc" },
      select: { name: true, price: true, creditAmount: true },
    }),
    prisma.point.findMany({ where: { tenantId: tenant.id, active: true }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  if (plans.length === 0 || points.length === 0) return null;

  const currency = tenant.currency as CurrencyCode | null;
  const pointNames = points.map((p) => escapeHtml(p.name)).join(", ");
  const lines = [s.abonementsIntro(pointNames)];
  for (const plan of plans) {
    const priceStr = formatMoneyWithCurrency(Number(plan.price), "ru", currency);
    const creditStr = formatMoneyWithCurrency(Number(plan.creditAmount), "ru", currency);
    // Безымянный план (Abonement.name опционален) — тот же фоллбэк, что уже
    // используют владельческие/операторские экраны (plan.name ?? цена).
    // Экранируем ДО подстановки в HTML-шаблон abonementLine (запрос
    // пользователя 2026-07-25 про форматирование) — название плана задаёт
    // Владелец, может содержать "<"/">"/"&".
    lines.push(s.abonementLine(plan.name ? escapeHtml(plan.name) : priceStr, priceStr, creditStr));
  }
  return lines.join("\n");
}

// Общий "успех" для /balance, /start и генерик-флоу handleContact — отчёт +
// постоянное меню с уже вычисленными showJoin/showBonus (запрос пользователя
// 2026-07-25 про кнопку "Абонементы") — раньше было 4 одинаковых вызова
// sendChatMessageWithMenu(...) подряд, добавление ещё одного флага в каждый
// легко забыть в одном из мест.
async function sendClientReportWithMenu(
  chatId: string,
  tenant: { id: string; name: string; currency: string | null },
  wallet: { id: string; name: string | null; balance: unknown },
  lang: BotLang
): Promise<void> {
  const [report, showJoin, showBonus] = await Promise.all([
    buildClientReport(chatId, tenant, wallet, lang),
    tenantHasActiveGroup(tenant.id, chatId),
    tenantHasAbonementsToSell(tenant.id),
  ]);
  await sendChatMessageWithMenu(chatId, report, BOT_STRINGS[lang], { showJoin, showBonus }).catch(() => {});
}

// 20 — как у Печатной выписки (запрос пользователя 2026-07-24: "то же
// самое и при запросе /balance"), было 5.
const HISTORY_LIMIT = 20;

// Баланс + последние операции + непогашенные заказы билетов — всё одним
// сообщением (запрос пользователя 2026-07-22: клиент не должен разбираться в
// отдельных командах, один тап по кнопке даёт полную картину сразу).
async function buildClientReport(
  chatId: string,
  tenant: { id: string; name: string; currency: string | null },
  wallet: { id: string; name: string | null; balance: unknown },
  lang: BotLang
): Promise<string> {
  const s = BOT_STRINGS[lang];
  const currency = tenant.currency as CurrencyCode | null;
  // Название компании — только если у ЭТОГО чата привязано больше одной
  // компании (запрос пользователя 2026-07-26, тот же принцип, что у
  // notifyWalletBalanceChange в lib/abonement.ts) — в отчёте/выписке /balance
  // так же легко перепутать, о какой компании речь, как и в проактивном пуше.
  const otherLinks = await prisma.clientTelegramLink.findMany({ where: { chatId }, select: { tenantId: true } });
  const isMultiTenant = new Set(otherLinks.map((l) => l.tenantId)).size > 1;
  const lines = [
    greetingLine(wallet.name ? escapeHtml(wallet.name) : null, s),
    ...(isMultiTenant ? [s.companyLine(escapeHtml(tenant.name))] : []),
    `${s.yourBalance}: <b>${formatMoneyWithCurrency(Number(wallet.balance), "ru", currency)}</b>`,
  ];

  // Обогащённая история (запрос пользователя 2026-07-23: раньше строка была
  // просто "22.07  −150 ₽" без объяснения, за что; синхронизировано с
  // Печатной выпиской, запрос пользователя 2026-07-24: "там тоже должно
  // быть как и в Печатной выписке") — те же связи и тот же общий резолвер
  // describeAbonementTransactionSource (lib/abonement.ts), что и у
  // /api/abonement-wallets/[id] / /api/operator/abonements. Раньше тут был
  // отдельный, слегка другой набор фолбэков (включая h.asset — поле,
  // которое "Счётчики" больше не проставляют после отказа от привязки к
  // активу в этом потоке, реальный баг, найденный при синхронизации 2026-07-24).
  const history = await prisma.abonementTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { occurredAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      type: true,
      amount: true,
      occurredAt: true,
      quantity: true,
      abonement: { select: { name: true } },
      launch: { select: { zone: { select: { name: true } } } },
      goodsSale: { select: { goods: { select: { name: true } } } },
      ticketOrder: { select: { zone: { select: { name: true } } } },
      tariff: { select: { zone: { select: { name: true } } } },
    },
  });
  if (history.length > 0) {
    lines.push("", `<b>${s.recentOps}:</b>`);
    for (const h of history) {
      const sign = h.type === "spend" ? "−" : "+";
      // Короткие дата+время (запрос пользователя 2026-07-24), та же пара
      // опций, что в Печатной выписке.
      const date = h.occurredAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
      const time = h.occurredAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      // "migration" (перенос баланса при импорте клиентов, 2026-08-02) идёт
      // в ту же ветку, что и "adjustment" — "Начисление". Клиенту не нужно
      // знать, что владелец переехал с другого ПО; ему важно, что баланс
      // начислен, а не потрачен. Новый ключ в telegram-client-i18n (15
      // языков вручную) ради этого не заводим.
      const typeLabel =
        h.type === "spend"
          ? s.typeSpend
          : h.type === "refund"
            ? s.typeRefund
            : h.type === "adjustment" || h.type === "migration"
              ? s.typeAdjustment
              : s.typeTopup;
      // Количество (запрос пользователя 2026-07-24: "в Печатную сводку и
      // везде должно быть указано количество") — только у "Счётчиков", там
      // где реально можно списать несколько тарифов за раз.
      const rawDetail = h.abonement?.name ?? describeAbonementTransactionSource(h);
      const detailBase = rawDetail ? escapeHtml(rawDetail) : null;
      const detail = detailBase && h.quantity ? `${detailBase} × ${h.quantity}` : detailBase;
      // Слово "Списание" убрано (запрос пользователя 2026-07-24: "это итак
      // понятно, ведь число с минусом") — при известном источнике просто
      // название зоны/товара, знак минус и так говорит, что это расход;
      // "Пополнение"/"Возврат"/"Корректировка" оставлены — одинаковый плюс
      // у них означает разное, знаком не различить.
      const label = h.type === "spend" ? (detail ?? typeLabel) : detail ? `${typeLabel} · ${detail}` : typeLabel;
      // Сумма — жирным (запрос пользователя 2026-07-25: "красивое
      // форматирование... суммы жирным"), остальное обычным текстом.
      lines.push(`${date} ${time}  ${label}  <b>${sign}${formatMoneyWithCurrency(Number(h.amount), "ru", currency)}</b>`);
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
      lines.push(`№${o.number} — <b>${o.openTicketsCount}</b> ${s.ticketsWord}`);
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

  const lang = pickBotLang(message.from?.language_code);

  // Саморегистрация ждёт имя (запрос пользователя 2026-07-25) — проверяем
  // ПЕРЕД обычным матчингом команд/кнопок: на этом шаге ЛЮБОЙ текст от этого
  // чата трактуется как попытка ввести имя, не как команда (даже если он
  // случайно совпал с текстом одной из кнопок меню).
  const session = await prisma.clientBotSession.findUnique({ where: { chatId } });
  if (session?.awaitingRegistrationName && session.pendingRegistrationTenantId && session.pendingRegistrationPhone) {
    await handleRegistrationName(chatId, session.pendingRegistrationTenantId, session.pendingRegistrationPhone, text, lang);
    return;
  }

  // Личный чат клиента: /balance тут без аргумента — просто "покажи мой
  // баланс ещё раз" (та же команда, что зарегистрирована в BotFather для
  // Direct Messages). Если чат ещё ни разу не проходил проверку контактом —
  // предлагаем это сделать сразу же (тот же generic-флоу, что у голого
  // /start), а не просто отсылаем к ссылке. Кнопки постоянного меню шлют
  // человекочитаемый локализованный текст, не голую команду (запрос
  // пользователя 2026-07-24) — matchesMenuCommand матчит и то, и другое, не
  // важно, на каком из 15 языков подписана кнопка у конкретного клиента.
  if (matchesMenuCommand(text, /^\/balance(?:@\w+)?/, (s) => s.balanceMenuButton)) {
    await handlePrivateBalanceCommand(chatId, lang);
  } else if (matchesMenuCommand(text, /^\/register(?:@\w+)?/, (s) => s.registerMenuButton)) {
    await handleRegisterTap(chatId, lang);
  } else if (matchesMenuCommand(text, /^\/services(?:@\w+)?/, (s) => s.servicesMenuButton)) {
    await handleServicesCommand(chatId, lang);
  } else if (matchesMenuCommand(text, /^\/bonus(?:@\w+)?/, (s) => s.bonusMenuButton)) {
    await handleBonusCommand(chatId, lang);
  } else if (matchesMenuCommand(text, /^\/join(?:@\w+)?/, (s) => s.joinMenuButton)) {
    await handleJoinCommand(chatId, lang);
  }
}

function matchesMenuCommand(text: string, commandRegex: RegExp, buttonLabel: (s: BotStringSet) => string): boolean {
  if (commandRegex.test(text)) return true;
  return Object.values(BOT_STRINGS).some((s) => buttonLabel(s) === text);
}

const BALANCE_TENANT_CALLBACK_PREFIX = "balt:";

// "/balance" — резолв тенанта той же схемой, что /services, /join, /bonus
// (клиент может быть привязан к нескольким прокатам платформы одним
// номером, запрос пользователя 2026-07-26: "Я клиент у двух Владельцев...
// надо, чтобы при запросе баланса тоже спрашивалось у какого владельца") —
// раньше при нескольких привязках бот молча слал ОБА баланса подряд, без
// выбора. chooseCompanyPrompt ("Выберите компанию") — единая формулировка
// для ВСЕХ команд с выбором тенанта (/balance, /services, /join, /bonus,
// запрос пользователя 2026-07-26: "не 'выберите прокат', а просто 'Выберите
// компанию'" — распространено на все места, старое "Выберите прокат"
// нигде больше не используется).
async function handlePrivateBalanceCommand(chatId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  const links = await prisma.clientTelegramLink.findMany({ where: { chatId } });
  if (links.length === 0) {
    await promptContactShare(chatId, null, undefined, lang);
    return;
  }

  // Тенант годится, только если модуль включён И у него реально есть кошелёк
  // на этот телефон — та же пара проверок, что раньше стояла внутри цикла
  // рассылки, просто теперь сначала считаем, СКОЛЬКО их, прежде чем решать
  // между прямой отправкой и выбором.
  const tenantIds: string[] = [];
  for (const link of links) {
    if (!(await isModuleEnabled(link.tenantId, "clientsEnabled"))) continue;
    const wallet = await findWalletByPhone(link.tenantId, link.phone);
    if (!wallet) continue;
    tenantIds.push(link.tenantId);
  }
  if (tenantIds.length === 0) return;

  if (tenantIds.length === 1) {
    await sendBalanceForTenant(chatId, tenantIds[0], lang);
    return;
  }

  const tenants = await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } });
  const buttons = tenants.map((t) => ({ text: t.name, callbackData: `${BALANCE_TENANT_CALLBACK_PREFIX}${t.id}` }));
  await sendInlineKeyboard(chatId, s.chooseCompanyPrompt, buttons).catch(() => {});
}

async function sendBalanceForTenant(chatId: string, tenantId: string, lang: BotLang) {
  // Перечитываем link по tenantId+chatId (не полагаемся на тот, что уже
  // проверили в handlePrivateBalanceCommand — кнопка выбора компании может
  // быть нажата из старого сообщения, та же защита, что у sendServicesForTenant
  // и соседей: "проверка обязана стоять именно здесь, не только выше по цепочке").
  const link = await prisma.clientTelegramLink.findUnique({ where: { tenantId_chatId: { tenantId, chatId } } });
  if (!link) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, currency: true } });
  if (!tenant || !(await isModuleEnabled(tenant.id, "clientsEnabled"))) return;
  const wallet = await findWalletByPhone(tenant.id, link.phone);
  if (!wallet) return;
  await sendClientReportWithMenu(chatId, tenant, wallet, lang);
}

const SERVICES_TENANT_CALLBACK_PREFIX = "svct:";
const JOIN_TENANT_CALLBACK_PREFIX = "joint:";
const SERVICES_POINT_CALLBACK_PREFIX = "svcp:";
const BONUS_TENANT_CALLBACK_PREFIX = "bonust:";

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
  const linkedTenantIds = [...new Set(links.map((l) => l.tenantId))];
  // Тумблер "Клиенты" — та же серверная проверка, что у /balance и контакт-
  // верификации (строки 201/277/304), пропущенная здесь при добавлении
  // /services (найдено аудитом 2026-07-24): без нeё выключенный владельцем
  // модуль всё равно продолжал бы отдавать список зон/активов уже
  // привязанным чатам.
  const tenantIds: string[] = [];
  for (const id of linkedTenantIds) {
    if (await isModuleEnabled(id, "clientsEnabled")) tenantIds.push(id);
  }

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
  await sendInlineKeyboard(chatId, s.chooseCompanyPrompt, buttons).catch(() => {});
}

async function sendServicesForTenant(chatId: string, tenantId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  // Прямая точка входа и из handleServicesCommand, и из callback-кнопки
  // (данные кнопки — свежие, но сама кнопка может быть нажата из старого
  // сообщения уже после того, как владелец выключил "Клиенты") — проверка
  // обязана стоять именно здесь, не только выше по цепочке.
  if (!(await isModuleEnabled(tenantId, "clientsEnabled"))) {
    await sendChatMessage(chatId, s.noServicesFound).catch(() => {});
    return;
  }
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
      tenant: { select: { slug: true, landingEnabled: true, landing: { select: { status: true } } } },
      zones: {
        where: { active: true },
        orderBy: { createdAt: "asc" },
        select: {
          name: true,
          telegramEmoji: true,
          accountingMode: true,
          // Билеты — единственный режим, где одна "витрина" может продавать
          // сразу несколько разных активов под одним именем (запрос
          // пользователя 2026-07-24: "для билетов имеет смысл показывать
          // активы") — у остальных режимов имя самой витрины уже и есть
          // конкретный актив, перечислять активы там избыточно.
          assets: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { name: true } },
        },
      },
    },
  });
  if (!point) return;

  const lines = [`<b>${escapeHtml(point.name)}</b>`, ""];
  if (point.zones.length === 0) {
    lines.push(s.noServicesFound);
  } else {
    for (const zone of point.zones) {
      const emoji = zone.telegramEmoji ?? "🏁";
      const zoneName = escapeHtml(zone.name);
      if (zone.accountingMode === "tickets" && zone.assets.length > 0) {
        lines.push(`${emoji} ${zoneName}:`);
        for (const asset of zone.assets) {
          lines.push(`  • ${escapeHtml(asset.name)}`);
        }
      } else {
        lines.push(`${emoji} ${zoneName}`);
      }
    }
  }
  const text = lines.join("\n");

  // Ссылка на лендинг — только если Владелец не отключил модуль (запрос
  // пользователя 2026-07-24: "надо учесть, чтобы он был включён у Владельца")
  // И лендинг реально ОПУБЛИКОВАН, не черновик (реальный баг, найден
  // пользователем 2026-07-26: "кнопка... не может быть, если Владелец не
  // опубликовал Лендинг" — публичная /s/[slug] отдаёт пустую страницу для
  // status !== "published", см. src/app/(site)/s/[slug]/page.tsx; landingEnabled
  // сам по себе — только тумблер модуля, не гарантирует, что там есть что
  // показать). Без выполнения обоих условий — просто обычное сообщение без кнопок.
  if (point.tenant.landingEnabled && point.tenant.slug && point.tenant.landing?.status === "published") {
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
  const data = await Promise.all(points.map((p) => buildDailyCashSummaryData(p.id, bounds, [])));

  const money = (n: number) => formatMoneyWithCurrency(n, "ru", currency);
  const totals = { cash: 0, mobile: 0, abonement: 0 };
  const lines = ["<b>Касса сейчас:</b>"];

  points.forEach((p, i) => {
    const d = data[i];
    if (!d) return;
    totals.cash += d.cashOnHand;
    totals.mobile += d.mobileAmount;
    totals.abonement += d.abonementAmount;

    if (points.length > 1) lines.push("", `<b>${escapeHtml(p.name)}</b>`);
    lines.push(`💵 Наличные: <b>${money(d.cashOnHand)}</b>`);
    if (d.mobileAmount > 0) lines.push(`💳 Безнал: <b>${money(d.mobileAmount)}</b>`);
    if (d.abonementAmount > 0) lines.push(`👨🏻‍💼 Баланс: <b>${money(d.abonementAmount)}</b>`);
  });

  if (points.length > 1) {
    lines.push("", "<b>Итого:</b>");
    lines.push(`💵 Наличные: <b>${money(totals.cash)}</b>`);
    if (totals.mobile > 0) lines.push(`💳 Безналичные сегодня: <b>${money(totals.mobile)}</b>`);
    if (totals.abonement > 0) lines.push(`👨🏻‍💼 Баланс сегодня: <b>${money(totals.abonement)}</b>`);
  }

  await sendChatMessage(chatId, lines.join("\n")).catch(() => {});
}

// "/join" — ссылка на публичную группу анонсов тенанта (запрос пользователя
// 2026-07-24: "как стимулировать клиентов присоединяться"). Та же схема
// резолва тенанта, что у /services (клиент может быть привязан к нескольким
// прокатам платформы) — но без каскада по точкам, группа одна на тенанта.
async function handleJoinCommand(chatId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  const links = await prisma.clientTelegramLink.findMany({ where: { chatId }, select: { tenantId: true } });
  const linkedTenantIds = [...new Set(links.map((l) => l.tenantId))];
  if (linkedTenantIds.length === 0) {
    await sendChatMessage(chatId, s.servicesNotLinkedHint).catch(() => {});
    return;
  }

  // Реальный баг, найден пользователем 2026-07-27: список компаний строился
  // только по clientsEnabled — компанию без подключённой/включённой группы
  // всё равно показывали кнопкой, тап неизбежно упирался в
  // "Группа пока не подключена". Теперь компания без рабочей группы вообще
  // не попадает в список. Но tenantHasActiveGroup (для кнопки "Будем
  // вместе" в обычном меню) — ОДНА проверка на два разных состояния сразу:
  // "не настроена" и "клиент уже состоит", оба схлопывались в один false.
  // Из-за этого, если клиент уже состоит СРАЗУ во всех своих привязанных
  // группах, список получался пустым и падал в "не подключена" — неверно и
  // непонятно (запрос пользователя 2026-07-27: "если клиент состоит в
  // обоих группах то при join будет просто пусто"). Здесь — три раздельные
  // корзины на каждого тенанта вместо одного bool.
  const joinableIds: string[] = [];
  const alreadyMemberNames: string[] = [];
  const notConfiguredNames: string[] = [];
  for (const id of linkedTenantIds) {
    if (!(await isModuleEnabled(id, "clientsEnabled"))) continue;
    const group = await getTenantPublicGroup(id);
    if (!group?.inviteLink || !group.enabled) {
      const tenant = await prisma.tenant.findUnique({ where: { id }, select: { name: true } });
      if (tenant) notConfiguredNames.push(tenant.name);
      continue;
    }
    const isMember = group.chatId ? await isChatMember(group.chatId, chatId) : false;
    if (isMember) {
      const tenant = await prisma.tenant.findUnique({ where: { id }, select: { name: true } });
      if (tenant) alreadyMemberNames.push(tenant.name);
    } else {
      joinableIds.push(id);
    }
  }
  const tenantIds = joinableIds;

  if (tenantIds.length === 0) {
    // Человеческое предложение вместо "Имя: текст" построчно (запрос
    // пользователя 2026-07-27: "Вы состоите в группе Керен Центра, но у
    // КидсБурга группы нет" — оба факта в одном сообщении, не приоритет
    // одного над другим). Каждая функция сама решает единственное/
    // множественное число по длине списка.
    const parts: string[] = [];
    if (alreadyMemberNames.length > 0) parts.push(s.joinAlreadyList(alreadyMemberNames));
    if (notConfiguredNames.length > 0) parts.push(s.joinNotConfiguredList(notConfiguredNames));
    await sendChatMessage(chatId, parts.length > 0 ? parts.join(" ") : s.joinGroupNotConfigured).catch(() => {});
    return;
  }
  if (tenantIds.length === 1) {
    await sendJoinForTenant(chatId, tenantIds[0], lang);
    return;
  }

  const tenants = await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } });
  const buttons = tenants.map((t) => ({ text: t.name, callbackData: `${JOIN_TENANT_CALLBACK_PREFIX}${t.id}` }));
  await sendInlineKeyboard(chatId, s.chooseCompanyPrompt, buttons).catch(() => {});
}

async function sendJoinForTenant(chatId: string, tenantId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  // Имя тенанта — сразу, не только в ветке "не настроена": срабатывает и
  // когда компания ровно одна (handleJoinCommand отправляет сюда напрямую,
  // без выбора кнопкой), и когда клиент тапнул конкретную кнопку в списке —
  // оба раза сообщение теперь называет компанию (запрос пользователя
  // 2026-07-27: "если нажато КидсБург: 'У КидсБург нет группы пока'").
  const [group, tenant] = await Promise.all([
    getTenantPublicGroup(tenantId),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);
  // group.enabled — тот же тумблер, что уже проверяют исходящие анонсы
  // (announceNewZone/Point/Asset, abonement-wallets/broadcast) — реальный
  // баг, найден пользователем 2026-07-25: Владелец выключил группу
  // тумблером (или физически удалил её в Telegram — inviteLink при этом не
  // стирается, disconnect намеренно его не трогает, см. .../disconnect/
  // route.ts), а клиентам бот всё равно предлагал старую ссылку — эта
  // проверка раньше смотрела только на наличие inviteLink.
  if (!group?.inviteLink || !group.enabled) {
    await sendChatMessage(chatId, tenant ? s.joinNotConfiguredList([tenant.name]) : s.joinGroupNotConfigured).catch(() => {});
    return;
  }
  // Клиент уже состоит в группе (запрос пользователя 2026-07-25) — та же
  // проверка, что уже прячет саму кнопку в постоянном меню (см.
  // tenantHasActiveGroup); здесь дублируется на случай, если клиент всё
  // равно наберёт "/join" текстом руками, а не тапнет по меню.
  if (group.chatId && (await isChatMember(group.chatId, chatId))) {
    await sendChatMessage(chatId, tenant ? s.joinAlreadyList([tenant.name]) : s.alreadyInGroup).catch(() => {});
    return;
  }
  await sendInlineKeyboard(chatId, s.joinGroupPrompt, [{ text: s.joinMenuButton, url: group.inviteLink }]).catch(() => {});
}

// "/bonus" — список планов абонементов + где купить (запрос пользователя
// 2026-07-25: "чтобы клиенты могли всегда посмотреть какие есть абонементы
// и где можно купить"). Та же схема резолва тенанта, что у /services и
// /join (клиент может быть привязан к нескольким прокатам платформы).
async function handleBonusCommand(chatId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  const links = await prisma.clientTelegramLink.findMany({ where: { chatId }, select: { tenantId: true } });
  const linkedTenantIds = [...new Set(links.map((l) => l.tenantId))];
  if (linkedTenantIds.length === 0) {
    await sendChatMessage(chatId, s.servicesNotLinkedHint).catch(() => {});
    return;
  }

  // Та же дыра, что была у /join (запрос пользователя 2026-07-27: "такое же
  // может быть и с другими вопросами... у Владельца нет абонементов") —
  // раньше список кнопок строился только по clientsEnabled, компания без
  // единого абонемента на продажу всё равно попадала кнопкой и упиралась в
  // безымянный noAbonementsAvailable. Теперь то же разделение на корзины,
  // что у /join: можно показать / нечего показать (с именем компании).
  const availableIds: string[] = [];
  const notAvailableNames: string[] = [];
  for (const id of linkedTenantIds) {
    if (!(await isModuleEnabled(id, "clientsEnabled"))) continue;
    if (await tenantHasAbonementsToSell(id)) {
      availableIds.push(id);
    } else {
      const tenant = await prisma.tenant.findUnique({ where: { id }, select: { name: true } });
      if (tenant) notAvailableNames.push(tenant.name);
    }
  }

  if (availableIds.length === 0) {
    await sendChatMessage(
      chatId,
      notAvailableNames.length > 0 ? s.noAbonementsList(notAvailableNames) : s.noAbonementsAvailable
    ).catch(() => {});
    return;
  }
  if (availableIds.length === 1) {
    await sendBonusForTenant(chatId, availableIds[0], lang);
    return;
  }

  const tenants = await prisma.tenant.findMany({ where: { id: { in: availableIds } }, select: { id: true, name: true } });
  const buttons = tenants.map((t) => ({ text: t.name, callbackData: `${BONUS_TENANT_CALLBACK_PREFIX}${t.id}` }));
  await sendInlineKeyboard(chatId, s.chooseCompanyPrompt, buttons).catch(() => {});
}

async function sendBonusForTenant(chatId: string, tenantId: string, lang: BotLang) {
  const s = BOT_STRINGS[lang];
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, currency: true } });
  if (!tenant) return;
  if (!(await isModuleEnabled(tenantId, "clientsEnabled"))) {
    await sendChatMessage(chatId, s.noAbonementsList([tenant.name])).catch(() => {});
    return;
  }
  const info = await buildAbonementsInfo(tenant, lang);
  await sendChatMessage(chatId, info ?? s.noAbonementsList([tenant.name])).catch(() => {});
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
  } else if (data.startsWith(JOIN_TENANT_CALLBACK_PREFIX)) {
    await sendJoinForTenant(chatId, data.slice(JOIN_TENANT_CALLBACK_PREFIX.length), lang);
  } else if (data.startsWith(BONUS_TENANT_CALLBACK_PREFIX)) {
    await sendBonusForTenant(chatId, data.slice(BONUS_TENANT_CALLBACK_PREFIX.length), lang);
  } else if (data.startsWith(BALANCE_TENANT_CALLBACK_PREFIX)) {
    await sendBalanceForTenant(chatId, data.slice(BALANCE_TENANT_CALLBACK_PREFIX.length), lang);
  }
}
