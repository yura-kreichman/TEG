import { prisma } from "@/lib/prisma";
import { deleteChatMessage, editChatMessage } from "@/lib/telegram-bot";
import { getDictionary } from "@/lib/i18n";
import { isLocale, type Locale } from "@/lib/locales";
import { calcOperatorBalance, calcShiftAccrual, getRateForDate, WORK_TIME_MONEY_TYPES } from "@/lib/work-time";
import {
  PUSH_NOTIFICATION_DEFAULTS,
  SHIFT_CLOSE_SUMMARY_DEFAULTS,
  type PushNotificationSettingsData,
} from "@/lib/summary-settings";
import { sendPushToTenant } from "@/lib/push-notifications";
import { formatCollectionAlertTelegram, formatShiftCloseSummaryTelegram } from "./telegram-format";
import { notifyDailyCashLateSubmission } from "./daily-cash-trigger";

/**
 * Пересборка уже отправленных Telegram-сообщений после правки (требование
 * владельца 2026-08-16: "любые правки должны редактировать все сообщения,
 * которые посылаются в телеграм").
 *
 * Правило простое: сообщение — это снимок данных на момент отправки, и если
 * данные поменялись, снимок обязан догнать их, а не остаться врать в чате.
 * Каждая правка задевает ДВА уровня сообщений:
 *   1. Своё событие — сводка по зоне у сдачи итогов, закрытие смены у
 *      смены/аванса/премии, "Новый расход" у расхода.
 *   2. "Касса за день" точки — она суммирует всё это разом, поэтому её
 *      обновляет любая денежная правка (notifyDailyCashLateSubmission ниже —
 *      уже существовавший механизм досдачи, здесь он же переиспользован).
 *
 * Всё best-effort: правка к моменту вызова уже сохранена, и недоступный чат
 * (сообщение удалили руками, бот выкинут из группы) не должен её ронять —
 * каждая функция глотает свои ошибки сама.
 */

/**
 * Запомнить id отправленной сводки "Закрытие смены" — вызывается сразу после
 * dispatchShiftCloseSummary в обоих местах закрытия (авто-режим check-out и
 * ручной ввод смены). Без этого правку было бы нечем догонять.
 */
export async function rememberShiftSummaryMessage(
  shiftId: string,
  results: { channelType: "telegram" | "email"; ok: boolean; externalMessageId?: string }[]
): Promise<void> {
  const messageId = results.find((r) => r.channelType === "telegram" && r.ok && r.externalMessageId)?.externalMessageId;
  if (!messageId) return;
  await prisma.shift
    .update({ where: { id: shiftId }, data: { telegramSummaryMessageId: messageId } })
    .catch((err) => console.error("shift summary message id save failed", { shiftId, err }));
}

/**
 * Push с уже поправленными данными (требование владельца 2026-08-16: "если
 * происходят обновления в ТГ, то Push должны отправляться свежие").
 * Сообщение в чате правится на месте, а Push отредактировать нельзя — вместо
 * этого уходит новый, с ♛ в заголовке: владелец должен понимать, что это не
 * второе событие, а исправление прежнего.
 *
 * Текст берётся тот же, что ушёл в Telegram, только без HTML-разметки —
 * шторка уведомлений её не понимает и показала бы теги как есть.
 */
export async function sendUpdatedPush(
  tenantId: string,
  kind: keyof PushNotificationSettingsData,
  title: string,
  telegramHtml: string
): Promise<void> {
  try {
    const settings = await prisma.pushNotificationSettings.findUnique({ where: { tenantId } });
    const enabled = settings ? settings[kind] : PUSH_NOTIFICATION_DEFAULTS[kind];
    if (!enabled) return;
    const body = telegramHtml
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    await sendPushToTenant(tenantId, { title: `${title} ♛`, body });
  } catch (err) {
    console.error("updated push failed", { tenantId, kind, err });
  }
}

/** Точка зоны — большинство правок знают только зону, а "Касса за день" живёт на точке. */
async function pointIdOfZone(zoneId: string): Promise<string | null> {
  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, select: { pointId: true } });
  return zone?.pointId ?? null;
}

/**
 * "Касса за день" точки за бизнес-день момента `at`. Если за этот день
 * сообщение не отправлялось — notifyDailyCashLateSubmission молча выходит,
 * ничего досылать не нужно (правка вчерашнего дня не должна порождать
 * сегодняшнюю сводку).
 */
export async function resyncDailyCashForPoint(pointId: string, tenantId: string, at: Date): Promise<void> {
  await notifyDailyCashLateSubmission(pointId, tenantId, at).catch((err) =>
    console.error("daily cash resync failed", { pointId, err })
  );
}

export async function resyncDailyCashForZone(zoneId: string, tenantId: string, at: Date): Promise<void> {
  const pointId = await pointIdOfZone(zoneId).catch(() => null);
  if (!pointId) return;
  await resyncDailyCashForPoint(pointId, tenantId, at);
}

/**
 * Единая точка для правки/удаления любой операции журнала: аванса, премии,
 * инкассации, расхода. Обновляет и сводку смены (если операция к ней
 * привязана), и "Кассу за день" точки, которой операция касается.
 *
 * Собственное сообщение операции (например, "Новый расход") редактирует
 * вызывающий роут — оно у каждого типа своё, а этот хелпер про общее.
 */
/**
 * Сообщение об инкассации после правки её суммы или удаления строки (запрос
 * владельца 2026-08-16). Группа строк одной инкассации опознаётся по общему
 * collectionAlertMessageId (см. lib/collection-alert.ts): доля каждой зоны,
 * пулы товаров/абонементов и "Аванс инкассации" пересобираются заново из
 * журнала — сообщение показывает то, что в нём есть СЕЙЧАС, а не то, что
 * ввели изначально.
 */
export async function resyncCollectionAlert(messageId: string, tenantId: string): Promise<void> {
  try {
    const ops = await prisma.moneyOperation.findMany({
      where: { collectionAlertMessageId: messageId, tenantId },
      include: {
        zone: { select: { name: true, telegramEmoji: true } },
        performedByOperator: { select: { name: true, colorTag: true } },
      },
      orderBy: { occurredAt: "asc" },
    });
    if (ops.length === 0) return;

    const [channel, tenant] = await Promise.all([
      prisma.tenantSummaryChannel.findFirst({
        where: { tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
      }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { locale: true, timezone: true, currency: true } }),
    ]);
    if (!channel?.chatId) return;

    const abs = (v: unknown) => Math.abs(Number(v));
    const zones = ops
      .filter((o) => o.type === "collection" && o.zone)
      .map((o) => ({ name: o.zone!.name, emoji: o.zone!.telegramEmoji, amount: abs(o.amount) }));
    const goodsAmount = ops.filter((o) => o.type === "collection_pool_sweep_goods").reduce((s, o) => s + abs(o.amount), 0);
    const abonementAmount = ops
      .filter((o) => o.type === "collection_pool_sweep_abonement")
      .reduce((s, o) => s + abs(o.amount), 0);
    const advanceAmount = ops.filter((o) => o.type === "collection_advance").reduce((s, o) => s + abs(o.amount), 0);
    const first = ops[0];

    const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
    const st = getDictionary(locale).summaryText;
    const data = {
      occurredAt: first.occurredAt,
      operatorName: first.performedByOperator?.name ?? null,
      operatorColorTag: first.performedByOperator?.colorTag ?? null,
      // Сумма — та, что в журнале сейчас: восстановить изначально введённую
      // после правки нечем, да и врать про неё незачем.
      amount: zones.reduce((s, z) => s + z.amount, 0) + goodsAmount + abonementAmount + advanceAmount,
      isAdvance: advanceAmount > 0,
      zones,
      goodsAmount,
      abonementAmount,
      editedByOwner: true,
    };
    const text = formatCollectionAlertTelegram(data, st, locale, tenant?.timezone ?? "UTC", tenant?.currency ?? null);
    await editChatMessage(channel.chatId, messageId, text);
    await sendUpdatedPush(tenantId, "collection", getDictionary(locale).pushSettings.collectionLabel, text);
  } catch (err) {
    console.error("collection alert resync failed", { messageId, err });
  }
}

export async function resyncAfterMoneyOpChange(op: {
  tenantId: string;
  zoneId: string | null;
  pointId: string | null;
  shiftId: string | null;
  occurredAt: Date;
  collectionAlertMessageId?: string | null;
}): Promise<void> {
  if (op.shiftId) await resyncShiftCloseMessage(op.shiftId);
  if (op.collectionAlertMessageId) await resyncCollectionAlert(op.collectionAlertMessageId, op.tenantId);
  if (op.pointId) await resyncDailyCashForPoint(op.pointId, op.tenantId, op.occurredAt);
  else if (op.zoneId) await resyncDailyCashForZone(op.zoneId, op.tenantId, op.occurredAt);
}

/**
 * Сводка "Закрытие смены". Отправляется в момент закрытия, а правится позже
 * тремя разными путями: владелец меняет время смены, правит привязанный к ней
 * аванс/премию или удаляет их. Все три ведут сюда.
 *
 * Пересобираем данные заново из смены (а не подставляем дельту): ставка
 * берётся на дату смены, суммы — из привязанных операций, "к выдаче" — это
 * текущий скользящий баланс сотрудника, он к моменту правки мог измениться и
 * по другим причинам.
 */
export async function resyncShiftCloseMessage(
  shiftId: string,
  options: { voided?: boolean } = {}
): Promise<void> {
  try {
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { operator: { select: { id: true, name: true, colorTag: true, tenantId: true } } },
    });
    if (!shift?.telegramSummaryMessageId || !shift.endAt) return;

    const tenantId = shift.operator.tenantId;
    const [channel, tenant, settingsRow, linkedOps] = await Promise.all([
      prisma.tenantSummaryChannel.findFirst({
        where: { tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
      }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { locale: true, timezone: true } }),
      prisma.shiftCloseSummarySettings.findUnique({ where: { tenantId } }),
      prisma.moneyOperation.findMany({
        where: { shiftId, type: { in: WORK_TIME_MONEY_TYPES } },
        select: { type: true, amount: true },
      }),
    ]);
    if (!channel?.chatId) return;

    const settings = settingsRow ?? SHIFT_CLOSE_SUMMARY_DEFAULTS;
    if (!settings.enabled) return;

    const rate = await getRateForDate(shift.operator.id, shift.startAt);
    const { minutes, accrued } = calcShiftAccrual(shift.startAt, shift.endAt, rate);
    const sumOf = (type: string) =>
      linkedOps.filter((o) => o.type === type).reduce((sum, o) => sum + Math.abs(Number(o.amount)), 0);
    const bonusPayout = sumOf("bonus_payout");
    const bonusAccrual = sumOf("bonus_accrual");
    const balance = await calcOperatorBalance(shift.operator.id);

    const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
    const text = formatShiftCloseSummaryTelegram(
      {
        // Сюда приходят только правки владельца — отсюда ♛ рядом с именем.
        editedByOwner: true,
        operatorName: shift.operator.name,
        operatorColorTag: shift.operator.colorTag,
        startAt: shift.startAt,
        endAt: shift.endAt,
        minutes,
        rate,
        accrued,
        advanceAmount: sumOf("advance"),
        bonusAmount: bonusPayout + bonusAccrual,
        // Тот же признак, что при отправке: премия начислена в баланс, а не
        // выдана наличными (docs/spec/05-work-time.md, режим "accrual").
        bonusIsAccrual: bonusAccrual > 0 && bonusPayout === 0,
        toPayOut: balance.toPayOut,
      },
      settings,
      locale,
      tenant?.timezone ?? "UTC",
      getDictionary(locale).summaryText
    );
    // Удаление смены: сообщение остаётся в чате с пометкой — стереть его
    // Telegram не даст (старше 48 часов), а молча оставленные цифры
    // удалённой смены хуже (правка владельца 2026-08-16).
    const finalText = options.voided
      ? `<i>${getDictionary(locale).summaryText.shiftVoided}</i>\n${text}`
      : text;
    if (options.voided) {
      await removeOrMarkMessage(channel.chatId, shift.telegramSummaryMessageId, finalText);
    } else {
      await editChatMessage(channel.chatId, shift.telegramSummaryMessageId, finalText);
    }
    await sendUpdatedPush(tenantId, "shiftCloseSummary", getDictionary(locale).pushSettings.shiftCloseLabel, finalText);
  } catch (err) {
    console.error("shift close resync failed", { shiftId, err });
  }
}

/**
 * Сообщение о событии, которого больше нет (удалили сдачу итогов, смену,
 * сверку кассы Товаров). Решение владельца 2026-08-16: "я бы их всех просто
 * удалял" — сначала пробуем удалить, и только если Telegram не дал (его
 * лимит — 48 часов на удаление своих сообщений), переписываем пометкой.
 * Молча оставлять цифры удалённой записи нельзя в любом случае.
 */
export async function removeOrMarkMessage(
  chatId: string,
  messageId: string,
  markedText: string
): Promise<void> {
  const deleted = await deleteChatMessage(chatId, messageId);
  if (deleted) return;
  await editChatMessage(chatId, messageId, markedText).catch(() => {});
}
