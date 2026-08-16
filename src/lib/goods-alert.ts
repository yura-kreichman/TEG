import { prisma } from "@/lib/prisma";
import { getDictionary } from "@/lib/i18n";
import { isLocale, type Locale } from "@/lib/locales";
import { editChatMessage } from "@/lib/telegram-bot";
import { calculateGoodsCashBeforeReconciliation } from "@/lib/goods";
import { dispatchGoodsAlert } from "@/lib/summary-channels/dispatch";
import { formatGoodsAlertTelegram } from "@/lib/summary-channels/telegram-format";
import { removeOrMarkMessage, sendUpdatedPush } from "@/lib/summary-channels/resync";
import type { GoodsReconciliationAlertData } from "@/lib/summary-channels/types";

/**
 * Уведомление о сдаче кассы Товаров (запрос владельца 2026-08-16) — единая
 * точка сборки данных для всех трёх событий: сдал сотрудник, поправил
 * владелец, удалил владелец. Иначе три места считали бы разницу по-своему и
 * рано или поздно разошлись бы.
 *
 * Расчётная касса берётся ровно так же, как в Итогах дня: окно "с прошлой
 * сверки этой точки по эту", а не календарный день — продажи после сдачи
 * относятся уже к следующей.
 */
async function buildAlertData(
  reconciliationId: string,
  options: { editedByOwner: boolean; voided: boolean }
): Promise<{ tenantId: string; data: GoodsReconciliationAlertData; messageId: string | null } | null> {
  const r = await prisma.goodsReconciliation.findUnique({
    where: { id: reconciliationId },
    include: {
      point: { select: { name: true, tenantId: true } },
      performedByOperator: { select: { name: true, colorTag: true } },
      performedByUser: { select: { id: true } },
    },
  });
  if (!r) return null;

  const previous = await prisma.goodsReconciliation.findFirst({
    where: { tenantId: r.tenantId, pointId: r.pointId, occurredAt: { lt: r.occurredAt } },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  const calculated = await calculateGoodsCashBeforeReconciliation(
    r.tenantId,
    r.pointId,
    previous?.occurredAt ?? null,
    r.occurredAt
  );

  const actualCash = Number(r.actualCash);
  const actualMobile = Number(r.actualMobile);
  // Точку подписываем только когда их несколько — иначе строка ни о чём.
  const pointCount = await prisma.point.count({ where: { tenantId: r.tenantId } });
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    tenantId: r.tenantId,
    messageId: r.alertMessageId,
    data: {
      occurredAt: r.occurredAt,
      // Сверку мог провести и владелец из кабинета — тогда имени нет, и
      // достаточно короны, которую рисует сам формат.
      operatorName: r.performedByOperator?.name ?? "",
      operatorColorTag: r.performedByOperator?.colorTag ?? null,
      actualCash,
      actualMobile,
      calculatedCash: round2(calculated.cash),
      calculatedMobile: round2(calculated.mobile),
      calculatedAbonement: round2(calculated.abonement),
      // Баланс в разницу не входит: эти деньги получены раньше, при
      // пополнении, — тот же принцип, что у зон и в Итогах дня.
      difference: round2(actualCash + actualMobile - calculated.cash - calculated.mobile),
      pointName: pointCount > 1 ? r.point.name : null,
      editedByOwner: options.editedByOwner || !!r.performedByUser,
      voided: options.voided,
    },
  };
}

/** Первое уведомление — сразу после сдачи кассы. */
export async function announceGoodsReconciliation(reconciliationId: string): Promise<void> {
  const built = await buildAlertData(reconciliationId, { editedByOwner: false, voided: false });
  if (!built) return;
  const { telegramMessageId } = await dispatchGoodsAlert(built.tenantId, built.data);
  if (telegramMessageId) {
    await prisma.goodsReconciliation.update({
      where: { id: reconciliationId },
      data: { alertMessageId: telegramMessageId },
    });
  }
}

/**
 * Правка или удаление сверки владельцем: уже отправленное сообщение
 * переписывается на месте (сквозное правило проекта — правка не порождает
 * второе сообщение), плюс уходит свежий Push: доставленное уведомление
 * отредактировать нельзя.
 *
 * При удалении сообщение остаётся в чате с пометкой: Telegram не даёт
 * удалять сообщения старше 48 часов, а молча оставить неверные цифры хуже.
 */
export async function resyncGoodsAlert(
  reconciliationId: string,
  options: { voided: boolean } = { voided: false }
): Promise<void> {
  const built = await buildAlertData(reconciliationId, { editedByOwner: true, voided: options.voided });
  if (!built || !built.messageId) return;

  const [channel, tenant] = await Promise.all([
    prisma.tenantSummaryChannel.findFirst({
      where: { tenantId: built.tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
    }),
    prisma.tenant.findUnique({
      where: { id: built.tenantId },
      select: { locale: true, timezone: true, currency: true },
    }),
  ]);
  const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  const dict = getDictionary(locale);
  const text = formatGoodsAlertTelegram(
    built.data,
    dict.summaryText,
    locale,
    tenant?.timezone ?? "UTC",
    tenant?.currency ?? null
  );
  if (channel?.chatId) {
    if (options.voided) {
      // Сверки больше нет — сообщение удаляем; пометка остаётся только когда
      // Telegram удалить не дал (решение владельца 2026-08-16).
      await removeOrMarkMessage(channel.chatId, built.messageId, text);
    } else {
      await editChatMessage(channel.chatId, built.messageId, text);
    }
  }
  await sendUpdatedPush(built.tenantId, "goods", dict.pushSettings.goodsLabel, text);
}
