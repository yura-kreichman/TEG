import { prisma } from "@/lib/prisma";
import { editChatMessage, sendChatMessage } from "@/lib/telegram-bot";
import { parseEmailAddresses, sendEmail } from "./email-channel";
import { formatMoney } from "@/lib/format";
import { isLocale, type Locale } from "@/lib/locales";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import {
  formatDailyCashSummaryEmail,
  formatExpenseAlertEmail,
  formatInstructionAckEmail,
  formatShiftCloseSummaryEmail,
  formatZoneSummaryEmail,
} from "./email-format";
import {
  formatCollectionAlertPush,
  formatCollectionAlertTelegram,
  formatDailyCashSummaryTelegram,
  formatExpenseAlertHeader,
  formatExpenseAlertLines,
  formatExpenseAlertTelegram,
  formatGoodsAlertTelegram,
  formatGoodsAlertHeader,
  formatGoodsAlertLines,
  formatInstructionAckTelegram,
  formatShiftCloseSummaryTelegram,
  formatZoneSummaryTelegram,
} from "./telegram-format";
import type {
  CollectionAlertData,
  DailyCashSummaryData,
  ExpenseAlertData,
  InstructionAckData,
  ShiftCloseSummaryData,
  ZoneSummaryData,
  GoodsReconciliationAlertData,
} from "./types";
import {
  GOODS_SUMMARY_DEFAULTS,
  PUSH_NOTIFICATION_DEFAULTS,
  type DailyCashSummarySettingsData,
  type PushNotificationSettingsData,
  type ShiftCloseSummarySettingsData,
  type ZoneSummarySettingsData,
} from "@/lib/summary-settings";
import { sendPushToTenant } from "@/lib/push-notifications";
import { colorTagToEmoji } from "@/lib/color-tag";

// Оркестратор доставки — единственное место, где "структурированные данные +
// настройки" превращаются в реальные отправки по включённым каналам тенанта
// (docs/spec/telegram-summaries.md, Шаг 3.5). Форматирование остаётся в
// telegram-format.ts/email-format.ts (чистые функции, тестируемые отдельно) —
// здесь только маршрутизация по каналам и сама отправка.
//
// Изоляция тенантов: chat_id/адреса берутся ТОЛЬКО из привязок этого tenantId,
// никаких параметров извне не принимается.

export interface DispatchResult {
  channelType: "telegram" | "email";
  ok: boolean;
  error?: string;
  externalMessageId?: string;
}

export async function getEnabledChannels(tenantId: string) {
  return prisma.tenantSummaryChannel.findMany({
    where: { tenantId, pointId: null, enabled: true },
  });
}

// Имя тенанта (для email), локаль (для formatMoney и для словаря ярлыков —
// запрос пользователя 2026-07-16: "переводы сводок надо сделать обязательно",
// раньше все ярлыки сводок были захардкожены на русском независимо от языка
// тенанта) и часовой пояс (для дат/времени в тексте сводок — реальный баг,
// найден 2026-07-15: время смены показывалось в сыром UTC сервера, а не в
// поясе тенанта, см. format-shared.ts) — всё нужно почти в каждой из функций
// ниже, один запрос вместо нескольких.
async function getTenantInfo(
  tenantId: string
): Promise<{ name: string; locale: Locale; timezone: string; currency: string | null; t: Dictionary }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    // currency — только для уведомления "Новый расход" (2026-08-15): одинокая
    // сумма в шторке телефона без знака валюты не читается, в отличие от
    // таблиц сводок, где валюта ясна из контекста.
    select: { name: true, locale: true, timezone: true, currency: true },
  });
  const locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  return {
    name: tenant?.name ?? "RentOS",
    locale,
    timezone: tenant?.timezone ?? "UTC",
    currency: tenant?.currency ?? null,
    t: getDictionary(locale),
  };
}

// Push — не отдельная запись в TenantSummaryChannel (та таблица рассчитана
// на ровно один chatId/список адресов на канал, а Push-подписок у тенанта
// может быть много — по одной на устройство владельца, см. push-notifications.ts).
// Дублируется коротким уведомлением независимо от того, настроен ли вообще
// Telegram/email — единственное условие, которое здесь проверяется, это
// PushNotificationSettings.<type>; сам dispatch вызывается только когда
// settings.enabled для этого типа сводки уже true (см. вызовы в
// submit-results/work-time-shifts/check-out), повторно это здесь не проверяем.
async function pushEnabledFor(tenantId: string, key: keyof PushNotificationSettingsData): Promise<boolean> {
  const settings = await prisma.pushNotificationSettings.findUnique({ where: { tenantId } });
  return settings ? settings[key] : PUSH_NOTIFICATION_DEFAULTS[key];
}

// Отправка не бросает исключений на "чат не найден"/SMTP-ошибку — это
// нормальный результат (ok:false в массиве), не exception. Без явного
// логирования здесь такие сбои были бы полностью невидимы (вызывающий код
// делает dispatch(...).catch(...) не глядя на результат — см. вызовы в
// submit-results/work-time-shifts). Одно место логирования на все три типа.
function logFailures(kind: string, tenantId: string, results: DispatchResult[]) {
  for (const r of results) {
    if (!r.ok) console.error(`summary dispatch failed`, { kind, tenantId, channelType: r.channelType, error: r.error });
  }
}

export async function dispatchZoneSummary(
  tenantId: string,
  data: ZoneSummaryData,
  settings: ZoneSummarySettingsData
): Promise<DispatchResult[]> {
  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatZoneSummaryTelegram(data, settings, tenant.locale, tenant.timezone, st);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const { subject, html } = formatZoneSummaryEmail(data, settings, tenant.name, tenant.locale, tenant.timezone, st);
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "zoneSummary")) {
    const sign = data.difference > 0 ? "+" : "";
    await sendPushToTenant(tenantId, {
      title: `${data.zoneEmoji ?? "🏁"} ${data.zoneName}`,
      body: `${st.cashOnly}: ${formatMoney(data.cashAmount, tenant.locale)} · ${st.difference}: ${sign}${formatMoney(data.difference, tenant.locale)}`,
      url: "/reports",
    }).catch((err) => console.error("push dispatch failed", { kind: "zone", tenantId, err }));
  }

  logFailures("zone", tenantId, results);
  return results;
}

export async function dispatchShiftCloseSummary(
  tenantId: string,
  data: ShiftCloseSummaryData,
  settings: ShiftCloseSummarySettingsData
): Promise<DispatchResult[]> {
  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatShiftCloseSummaryTelegram(data, settings, tenant.locale, tenant.timezone, st);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const { subject, html } = formatShiftCloseSummaryEmail(data, settings, tenant.name, tenant.locale, tenant.timezone, st);
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "shiftCloseSummary")) {
    // ⏹ и цветовая метка сотрудника — как у начала смены (запрос владельца
    // 2026-08-16): пара "▶️ начал / ⏹ закрыл" читается в шторке без текста.
    const mark = colorTagToEmoji(data.operatorColorTag);
    await sendPushToTenant(tenantId, {
      title: `⏹ ${mark ? `${mark} ` : ""}${data.operatorName} · ${st.shiftClosedSuffix}`,
      body: `${st.toPayOutCompact}: ${formatMoney(data.toPayOut, tenant.locale)}`,
      url: "/operators",
    }).catch((err) => console.error("push dispatch failed", { kind: "shiftClose", tenantId, err }));
  }

  logFailures("shiftClose", tenantId, results);
  return results;
}

// Касса за день умеет редактировать уже отправленное (досдача) — поэтому
// принимает существующие externalMessageId по каналам, если есть, и решает
// send/edit сама, канал за каналом (email редактировать не умеет — досдача
// по почте всегда уходит новым письмом, что нормально).
export async function dispatchDailyCashSummary(
  tenantId: string,
  data: DailyCashSummaryData,
  settings: DailyCashSummarySettingsData,
  existingMessageIds: Partial<Record<"telegram" | "email", string>>
): Promise<DispatchResult[]> {
  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatDailyCashSummaryTelegram(data, settings, tenant.locale, tenant.timezone, st);
      const existingId = existingMessageIds.telegram;
      const isEdit = !!existingId && settings.updateOnLateSubmission;
      const result = isEdit
        ? await editChatMessage(channel.chatId, existingId!, text)
        : await sendChatMessage(channel.chatId, text);
      results.push({
        channelType: "telegram",
        ok: result.ok,
        error: result.ok ? undefined : mapErrorDescription(result.description),
        externalMessageId: isEdit ? existingId : result.messageId,
      });
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const { subject, html } = formatDailyCashSummaryEmail(data, settings, tenant.name, tenant.locale, tenant.timezone, st);
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  // Push уходит и на обновление тоже (требование владельца 2026-08-16: "если
  // происходят обновления в ТГ, то Push должны отправляться свежие").
  // Отредактировать уже доставленное уведомление нельзя, поэтому на месте
  // правки/досдачи приходит новое, с 🔄 в заголовке — чтобы владелец видел,
  // что это не второй день, а исправленные цифры того же. Прежнее правило
  // "push только на первую отправку" отменено сознательно: цифры в шторке
  // расходились с чатом, и это оказалось хуже лишнего уведомления.
  const isUpdate = !!existingMessageIds.telegram || !!existingMessageIds.email;
  if (await pushEnabledFor(tenantId, "dailyCashSummary")) {
    const total = data.cashAmount + data.mobileAmount - data.expenses;
    // 💰 — тот же значок, что в шапке самой сводки в Telegram.
    const subject = data.showPointName ? `💰 ${st.dailyCashSubject} · ${data.pointName}` : `💰 ${st.dailyCashSubject}`;
    await sendPushToTenant(tenantId, {
      title: isUpdate ? `${subject} 🔄` : subject,
      body: `${st.totalCompact}: ${formatMoney(total, tenant.locale)}`,
      url: "/money",
    }).catch((err) => console.error("push dispatch failed", { kind: "dailyCash", tenantId, err }));
  }

  logFailures("dailyCash", tenantId, results);
  return results;
}

function toDispatchResult(
  channelType: "telegram",
  result: { ok: boolean; status: number; description?: string; messageId?: string }
): DispatchResult {
  return {
    channelType,
    ok: result.ok,
    error: result.ok ? undefined : mapErrorDescription(result.description),
    externalMessageId: result.messageId,
  };
}

function mapErrorDescription(description?: string): string {
  return description ?? "Не удалось отправить";
}

// Инструктажи (docs/spec/07-instructions.md, "Уведомления") — Push раньше
// слался безусловно (единственный тип без per-type тумблера); теперь тоже
// за pushEnabledFor, как Zone/DailyCash/ShiftClose (запрос пользователя
// 2026-07-16: "вдруг Владелец не хочет получать такие уведомления").
export async function dispatchInstructionAcknowledgment(tenantId: string, data: InstructionAckData): Promise<DispatchResult[]> {
  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatInstructionAckTelegram(data, st, tenant.t.instructions.minutesShort);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const { subject, html } = formatInstructionAckEmail(
        data,
        tenant.name,
        tenant.locale,
        st,
        tenant.t.instructions.fieldReadingTime,
        tenant.t.instructions.minutesShort,
        tenant.t.pushSettings.instructionAckLabel
      );
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "instructionAck")) {
    await sendPushToTenant(tenantId, {
      // ✅ — тот же значок, что в самом сообщении об ознакомлении.
      title: `✅ ${tenant.t.pushSettings.instructionAckLabel}`,
      body: `${data.fullName} · «${data.instructionTitle}» · ${data.readingMinutes} ${tenant.t.instructions.minutesShort}`,
      url: "/settings/instructions",
    }).catch((err) => console.error("push dispatch failed", { kind: "instructionAck", tenantId, err }));
  }

  logFailures("instructionAck", tenantId, results);
  return results;
}

// Начало смены в Авто-режиме учёта времени (запрос пользователя 2026-07-16:
// "Женя начал работать, а у Владельца сразу приходит Push") — только Push,
// без Telegram/email: это не "сводка" с настраиваемым составом, а короткое
// мгновенное уведомление, тот же принцип, что у InstructionAck, но ещё проще
// (сам вызывающий код — check-in route — уже гарантирует Авто-режим).
export async function dispatchShiftCheckin(
  tenantId: string,
  operatorName: string,
  pointName: string,
  operatorId: string,
  operatorColorTag: string | null = null
): Promise<void> {
  if (!(await pushEnabledFor(tenantId, "shiftCheckin"))) return;
  const tenant = await getTenantInfo(tenantId);
  // ▶️ в заголовке и цветовая метка сотрудника перед именем (запрос владельца
  // 2026-08-16) — в шторке уведомлений это единственное, по чему тип события
  // и человек опознаются с одного взгляда, без чтения текста. Метка — тот же
  // эмодзи-квадрат, что рядом с именем в сводках.
  const mark = colorTagToEmoji(operatorColorTag);
  await sendPushToTenant(tenantId, {
    title: `▶️ ${tenant.t.pushSettings.shiftCheckinLabel}`,
    body: `${mark ? `${mark} ` : ""}${operatorName} · ${pointName}`,
    url: `/operators/${operatorId}`,
  }).catch((err) => console.error("push dispatch failed", { kind: "shiftCheckin", tenantId, err }));
}

// Прежняя dispatchCollection (только Push, одна строка "кто · где · сколько")
// удалена 2026-08-16: инкассация стала полноценным сообщением, и все шесть
// роутов зовут dispatchCollectionAlert ниже через lib/collection-alert.ts.
// Два пути уведомления об одном событии — гарантированный источник
// расхождений, поэтому старый убран, а не оставлен "на всякий случай".

/**
 * Инкассация полноценным сообщением в Telegram/email (запрос владельца
 * 2026-08-16) — до этого о ней знал только Push, в чате команды её не было
 * видно вовсе. Тумблер Telegram/email проверяет вызывающий роут
 * (CollectionSummarySettings.enabled), Push — pushEnabledFor здесь; это те же
 * две независимые ручки, что у расхода.
 */
export async function dispatchCollectionAlert(
  tenantId: string,
  data: CollectionAlertData
): Promise<DispatchResult[]> {
  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatCollectionAlertTelegram(data, st, tenant.locale, tenant.timezone, tenant.currency);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const { title, body } = formatCollectionAlertPush(data, st, tenant.locale, tenant.timezone, tenant.currency);
      // Письмо об инкассации — те же две строки, без отдельной таблицы полей:
      // состав сообщения владелец не настраивает, разбивать нечего.
      const result = await sendEmail(addresses, title, `<p>${title}</p><p>${body.replace(/\n/g, "<br>")}</p>`);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "collection")) {
    const { title, body } = formatCollectionAlertPush(data, st, tenant.locale, tenant.timezone, tenant.currency);
    await sendPushToTenant(tenantId, { title, body, url: "/money/zone-balances" }).catch((err) =>
      console.error("push dispatch failed", { kind: "collectionAlert", tenantId, err })
    );
  }

  logFailures("collectionAlert", tenantId, results);
  return results;
}

/**
 * Новый расход, внесённый Сотрудником (запрос владельца 2026-08-15). Два
 * независимых тумблера, как и просили: Telegram/email — ExpenseSummarySettings
 * .enabled (проверяет вызывающий роут), Push — PushNotificationSettings.expense.
 *
 * Push повторяет ровно те же две строки, что уходят в Telegram, только без
 * HTML: шапка "🛒 РАСХОД — дата, время" заголовком, "🟥 Имя: сумма" телом.
 */
export async function dispatchExpenseAlert(tenantId: string, data: ExpenseAlertData): Promise<DispatchResult[]> {
  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatExpenseAlertTelegram(data, st, tenant.locale, tenant.timezone, tenant.currency);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const { subject, html } = formatExpenseAlertEmail(
        data,
        tenant.name,
        tenant.locale,
        st,
        tenant.timezone,
        tenant.currency
      );
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "expense")) {
    await sendPushToTenant(tenantId, {
      title: formatExpenseAlertHeader(data, st, tenant.timezone),
      body: formatExpenseAlertLines(data, tenant.locale, tenant.currency).join("\n"),
      url: "/money/expenses",
    }).catch((err) => console.error("push dispatch failed", { kind: "expense", tenantId, err }));
  }

  logFailures("expense", tenantId, results);
  return results;
}

/**
 * Сдача кассы Товаров (запрос владельца 2026-08-16) — Telegram/email + Push,
 * со своим тумблером, как у расхода и инкассации.
 *
 * Возвращает id отправленного Telegram-сообщения: по нему сверка правится и
 * аннулируется — сообщение переписывается на месте, а не отправляется заново
 * (сквозное правило проекта, см. lib/summary-channels/resync.ts).
 */
export async function dispatchGoodsAlert(
  tenantId: string,
  data: GoodsReconciliationAlertData
): Promise<{ results: DispatchResult[]; telegramMessageId: string | null }> {
  const settings = await prisma.goodsSummarySettings.findUnique({ where: { tenantId } });
  if (settings ? !settings.enabled : !GOODS_SUMMARY_DEFAULTS.enabled) {
    // Тумблер выключен — молчим и в Telegram, и в почте. Push остаётся своим
    // тумблером ниже: владелец мог отключить чат, но оставить уведомления.
    if (await pushEnabledFor(tenantId, "goods")) await sendGoodsPush(tenantId, data);
    return { results: [], telegramMessageId: null };
  }

  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;
  let telegramMessageId: string | null = null;

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatGoodsAlertTelegram(data, st, tenant.locale, tenant.timezone, tenant.currency);
      const result = await sendChatMessage(channel.chatId, text);
      if (result.ok && result.messageId) telegramMessageId = String(result.messageId);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const subject = `${st.goodsAlertTitle} · ${formatGoodsAlertHeader(data, st, tenant.timezone)}`;
      const html = formatGoodsAlertLines(data, st, tenant.locale, tenant.currency)
        .map((line) => `<p style="margin:0 0 6px">${line}</p>`)
        .join("");
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "goods")) await sendGoodsPush(tenantId, data);

  logFailures("goods", tenantId, results);
  return { results, telegramMessageId };
}

async function sendGoodsPush(tenantId: string, data: GoodsReconciliationAlertData): Promise<void> {
  const tenant = await getTenantInfo(tenantId);
  const st = tenant.t.summaryText;
  await sendPushToTenant(tenantId, {
    title: formatGoodsAlertHeader(data, st, tenant.timezone),
    body: formatGoodsAlertLines(data, st, tenant.locale, tenant.currency).join("\n"),
    url: "/money/readings",
  }).catch((err) => console.error("push dispatch failed", { kind: "goods", tenantId, err }));
}
