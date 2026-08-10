import { escapeHtml, sendChatMessage, sendInlineKeyboard } from "@/lib/telegram-bot";
import { getSystemSettingsConfig } from "@/lib/system-settings";

/**
 * Уведомления Super Admin'у о жизни платформы в его группу Telegram (запрос
 * пользователя 2026-08-10): новый Владелец, оплата, удаление кабинета. Шлёт
 * тот же единый бот, что и сводки Владельцам — отдельного бота платформа не
 * заводит (см. src/lib/telegram-bot.ts).
 *
 * Тексты по-русски и без i18n — админ-модуль русскоязычный по правилу проекта
 * (CLAUDE.md, "Admin module is Russian-only"), получатель здесь ровно один.
 *
 * Всё best-effort: уведомление не должно ронять то действие, о котором
 * сообщает. Провалившаяся отправка в Telegram не повод не создать кабинет по
 * оплате или не удалить тенанта — поэтому каждая функция глотает свои ошибки,
 * а вызывающий код не обязан их обрабатывать.
 */

type NotificationKind = "newOwner" | "payment" | "deletion";

async function notify(kind: NotificationKind, text: string, cardUrl?: string): Promise<void> {
  try {
    const { adminNotifications } = await getSystemSettingsConfig();
    if (!adminNotifications.chatId || !adminNotifications[kind]) return;

    if (cardUrl) {
      // Кнопкой, а не голым URL в тексте (правка пользователя 2026-08-10:
      // «спрячь ссылку, чтобы не было громоздкого URL») — Telegram рисует её
      // отдельной строкой под сообщением.
      await sendInlineKeyboard(adminNotifications.chatId, text, [{ text: "Открыть карточку", url: cardUrl }]);
      return;
    }

    await sendChatMessage(adminNotifications.chatId, text);
  } catch (err) {
    console.error("platform notification failed", kind, err);
  }
}

/**
 * Адрес кабинета для ссылки в кнопке. SITE_URL — тот же origin, что уже
 * используется для ссылок в письмах; без него кнопка просто не рисуется, а
 * текст уведомления уходит как есть.
 */
function adminTenantUrl(tenantId: string): string | undefined {
  const origin = process.env.SITE_URL;
  return origin ? `${origin}/admin/tenants/${tenantId}` : undefined;
}

export async function notifyNewOwner(params: {
  tenantId: string;
  companyName: string;
  email: string;
  packageName: string;
  /** Регистрация на сайте или кабинет, созданный автоматически по факту оплаты. */
  source: "registration" | "purchase";
}): Promise<void> {
  const source = params.source === "purchase" ? "по оплате" : "регистрация";
  const text =
    `🎉 <b>Новый Владелец</b> (${source})\n` +
    `${escapeHtml(params.companyName)}\n` +
    `${escapeHtml(params.email)}\n` +
    `Пакет: ${escapeHtml(params.packageName)}`;

  await notify("newOwner", text, adminTenantUrl(params.tenantId));
}

export async function notifyPayment(params: {
  tenantId: string;
  companyName: string;
  email: string | null;
  packageName: string | null;
  /** Имя события FluentCart — оно же определяет заголовок. */
  eventType: string;
}): Promise<void> {
  const titles: Record<string, string> = {
    order_paid_done: "💰 Оплата",
    subscription_activated: "💰 Подписка активирована",
    subscription_reactivated: "💰 Подписка возобновлена",
    subscription_renewed: "🔄 Продление подписки",
    subscription_canceled: "⚠️ Подписка отменена",
    subscription_eot: "⛔️ Подписка истекла",
    subscription_expired_validity: "⛔️ Подписка истекла",
    order_status_changed_to_canceled: "⛔️ Заказ отменён",
    order_fully_refunded: "↩️ Полный возврат",
  };

  const text =
    `${titles[params.eventType] ?? `ℹ️ ${escapeHtml(params.eventType)}`}\n` +
    `${escapeHtml(params.companyName)}\n` +
    (params.email ? `${escapeHtml(params.email)}\n` : "") +
    (params.packageName ? `Пакет: ${escapeHtml(params.packageName)}` : "");

  await notify("payment", text.trimEnd(), adminTenantUrl(params.tenantId));
}

export async function notifyTenantDeleted(params: {
  companyName: string;
  email: string | null;
  /** Автоудаление брошенного Free или ручное удаление из админки. */
  reason: "auto" | "manual";
}): Promise<void> {
  const reason = params.reason === "auto" ? "автоматически, брошенный Free" : "вручную из админки";
  const text =
    `🗑 <b>Кабинет удалён</b> (${reason})\n` +
    `${escapeHtml(params.companyName)}` +
    (params.email ? `\n${escapeHtml(params.email)}` : "");

  // Без кнопки: карточки уже не существует, ссылка вела бы в никуда.
  await notify("deletion", text);
}
