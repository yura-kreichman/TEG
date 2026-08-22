import { prisma } from "@/lib/prisma";
import { editChatMessage } from "@/lib/telegram-bot";
import { getDictionary } from "@/lib/i18n";
import { isLocale, type Locale } from "@/lib/locales";
import { formatExpenseAlertTelegram } from "@/lib/summary-channels/telegram-format";
import { pointNameIfMany } from "@/lib/summary-channels/dispatch";
import { removeOrMarkMessage, sendUpdatedPush } from "@/lib/summary-channels/resync";

/**
 * Судьба уже отправленного сообщения «Новый расход» после правки или удаления
 * записи. Живёт отдельно от роутов, потому что путей к нему теперь два:
 * Владелец в реестре расходов и Сотрудник в PWA (правка сотрудника добавлена
 * по требованию владельца 2026-08-19 — до этого у него была только кнопка
 * удаления, и правка расхода означала «удали и заведи заново», то есть новое
 * сообщение в чате вместо исправленного).
 */
async function loadTelegramChannel(tenantId: string) {
  const [channel, tenant] = await Promise.all([
    prisma.tenantSummaryChannel.findFirst({
      where: { tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { locale: true, timezone: true, currency: true } }),
  ]);
  const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  return { channel, tenant, locale };
}

/**
 * Переписывает сообщение по текущему состоянию расхода — best-effort, как у
 * сводки по зоне: падение здесь не должно ронять саму правку, она к этому
 * моменту уже сохранена.
 *
 * editedByOwner ставит ♛ в сообщении: это метка «запись правил Владелец», а
 * не «сообщение переписано». Сотрудник правит свой расход до сдачи итогов —
 * короны быть не должно.
 */
export async function resyncExpenseAlert(
  operationId: string,
  tenantId: string,
  options: { editedByOwner: boolean }
): Promise<void> {
  const op = await prisma.moneyOperation.findUnique({
    where: { id: operationId },
    include: {
      expenseCategory: { select: { name: true } },
      zone: { select: { name: true, telegramEmoji: true, point: { select: { name: true } } } },
      performedByOperator: { select: { name: true, colorTag: true } },
    },
  });
  if (!op?.expenseAlertMessageId) return;

  const { channel, tenant, locale } = await loadTelegramChannel(tenantId);
  if (!channel?.chatId) return;

  const text = formatExpenseAlertTelegram(
    {
      occurredAt: op.occurredAt,
      operatorName: op.performedByOperator?.name ?? "",
      operatorColorTag: op.performedByOperator?.colorTag ?? null,
      amount: Math.abs(Number(op.amount)),
      categoryName: op.expenseCategory?.name ?? null,
      pointName: await pointNameIfMany(tenantId, op.zone?.point.name ?? null),
      zoneName: op.zone?.name ?? "",
      zoneEmoji: op.zone?.telegramEmoji ?? null,
      comment: op.comment,
      editedByOwner: options.editedByOwner,
    },
    getDictionary(locale).summaryText,
    locale,
    tenant?.timezone ?? "UTC",
    tenant?.currency ?? null
  );
  await editChatMessage(channel.chatId, op.expenseAlertMessageId, text);
  // И свежий Push поверх исправленного сообщения (требование владельца
  // 2026-08-16) — отредактировать уже доставленное уведомление нельзя.
  await sendUpdatedPush(tenantId, "expense", getDictionary(locale).pushSettings.expenseLabel, text);
}

/**
 * Расход удалён — своё сообщение уходит вместе с записью (решение владельца
 * 2026-08-16), иначе оно остаётся в чате навсегда с суммой, которой в системе
 * уже нет. Старше 48 часов Telegram удалить не даст — тогда пометка.
 */
export async function removeExpenseAlert(
  messageId: string | null | undefined,
  tenantId: string
): Promise<void> {
  if (!messageId) return;
  const { channel, locale } = await loadTelegramChannel(tenantId);
  if (!channel?.chatId) return;
  await removeOrMarkMessage(
    channel.chatId,
    messageId,
    `<i>${getDictionary(locale).summaryText.expenseVoided}</i>`
  ).catch(() => {});
}
