import { prisma } from "@/lib/prisma";
import { editChatMessage, sendChatMessage } from "@/lib/telegram-bot";
import { parseEmailAddresses, sendEmail } from "./email-channel";
import { formatAmount } from "./format-shared";
import {
  formatDailyCashSummaryEmail,
  formatInstructionAckEmail,
  formatShiftCloseSummaryEmail,
  formatZoneSummaryEmail,
} from "./email-format";
import {
  formatDailyCashSummaryTelegram,
  formatInstructionAckTelegram,
  formatShiftCloseSummaryTelegram,
  formatZoneSummaryTelegram,
} from "./telegram-format";
import type { DailyCashSummaryData, InstructionAckData, ShiftCloseSummaryData, ZoneSummaryData } from "./types";
import {
  PUSH_NOTIFICATION_DEFAULTS,
  type DailyCashSummarySettingsData,
  type PushNotificationSettingsData,
  type ShiftCloseSummarySettingsData,
  type ZoneSummarySettingsData,
} from "@/lib/summary-settings";
import { sendPushToTenant } from "@/lib/push-notifications";

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

async function getEnabledChannels(tenantId: string) {
  return prisma.tenantSummaryChannel.findMany({
    where: { tenantId, pointId: null, enabled: true },
  });
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

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatZoneSummaryTelegram(data, settings);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const { subject, html } = formatZoneSummaryEmail(data, settings, tenant?.name ?? "RentOS");
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "zoneSummary")) {
    const sign = data.difference > 0 ? "+" : "";
    await sendPushToTenant(tenantId, {
      title: `${data.zoneEmoji ?? "🏁"} ${data.zoneName}`,
      body: `Касса: ${formatAmount(data.cashAmount)} · Разн.: ${sign}${formatAmount(data.difference)}`,
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

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatShiftCloseSummaryTelegram(data, settings);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const { subject, html } = formatShiftCloseSummaryEmail(data, settings, tenant?.name ?? "RentOS");
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  if (await pushEnabledFor(tenantId, "shiftCloseSummary")) {
    await sendPushToTenant(tenantId, {
      title: `${data.operatorName} · смена закрыта`,
      body: `Баланс: ${formatAmount(data.toPayOut)}`,
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

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatDailyCashSummaryTelegram(data, settings);
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
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const { subject, html } = formatDailyCashSummaryEmail(data, settings, tenant?.name ?? "RentOS");
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  // Досдача редактирует уже отправленное сообщение (см. комментарий к
  // функции) — push на каждое такое обновление превратился бы в спам
  // уведомлениями на телефоне владельца, поэтому шлём только на самую
  // первую отправку за business-day, не на editMessageText-обновления.
  const isUpdate = !!existingMessageIds.telegram || !!existingMessageIds.email;
  if (!isUpdate && (await pushEnabledFor(tenantId, "dailyCashSummary"))) {
    const total = data.cashAmount + data.mobileAmount - data.expenses;
    await sendPushToTenant(tenantId, {
      title: data.showPointName ? `Касса за день · ${data.pointName}` : "Касса за день",
      body: `Итог: ${formatAmount(total)}`,
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

// Инструктажи (docs/spec/07-instructions.md, "Уведомления") — единственное
// простое сообщение, без per-type Push-тумблера (в отличие от Zone/DailyCash/
// ShiftClose): шлётся, если у тенанта вообще есть хоть одна активная
// push-подписка, отдельного выключателя спека не просит.
export async function dispatchInstructionAcknowledgment(tenantId: string, data: InstructionAckData): Promise<DispatchResult[]> {
  const channels = await getEnabledChannels(tenantId);
  const results: DispatchResult[] = [];

  for (const channel of channels) {
    if (channel.channelType === "telegram" && channel.chatStatus === "active" && channel.chatId) {
      const text = formatInstructionAckTelegram(data);
      const result = await sendChatMessage(channel.chatId, text);
      results.push(toDispatchResult("telegram", result));
    } else if (channel.channelType === "email") {
      const addresses = parseEmailAddresses(channel.emailAddresses);
      if (addresses.length === 0) continue;
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const { subject, html } = formatInstructionAckEmail(data, tenant?.name ?? "RentOS");
      const result = await sendEmail(addresses, subject, html);
      results.push({ channelType: "email", ok: result.ok, error: result.error });
    }
  }

  await sendPushToTenant(tenantId, {
    title: "Инструктаж пройден",
    body: `${data.fullName} · «${data.instructionTitle}» · ${data.readingMinutes} мин.`,
    url: "/settings/instructions",
  }).catch((err) => console.error("push dispatch failed", { kind: "instructionAck", tenantId, err }));

  logFailures("instructionAck", tenantId, results);
  return results;
}
