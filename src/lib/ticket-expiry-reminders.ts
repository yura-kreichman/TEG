import { prisma } from "@/lib/prisma";
import { sendChatMessage } from "@/lib/telegram-bot";
import { BOT_STRINGS, greetingLine } from "@/lib/telegram-client-i18n";
import type { Locale } from "@/lib/locales";

// Напоминание клиенту в Telegram, что оплаченный заказ билетов скоро сгорит
// (запрос пользователя 2026-07-23) — только для Билетов (docs/spec/10-tickets.md,
// единственный режим, где оплата и использование разнесены во времени, см.
// комментарий у "Неиспользованные заказы" в вебхуке). Один раз на заказ
// (expiryReminderSentAt), не при каждом тике планировщика. Только заказы,
// оплаченные балансом (walletId not null) — у нал/безнал заказов нет
// привязки к конкретному человеку вообще, слать некому.
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function sendTicketExpiryReminders(now: Date): Promise<void> {
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);

  const orders = await prisma.ticketOrder.findMany({
    where: {
      openTicketsCount: { gt: 0 },
      expiresAt: { gt: now, lte: windowEnd },
      expiryReminderSentAt: null,
      walletId: { not: null },
    },
    select: {
      id: true,
      number: true,
      walletId: true,
      zone: { select: { point: { select: { tenantId: true } } } },
    },
  });
  if (orders.length === 0) return;

  for (const order of orders) {
    try {
      await sendReminderForOrder(order);
    } catch (err) {
      console.error("ticket expiry reminder failed", { orderId: order.id, err });
    }
  }
}

async function sendReminderForOrder(order: {
  id: string;
  number: number;
  walletId: string | null;
  zone: { point: { tenantId: string } };
}) {
  // walletId гарантирован не-null запросом выше (WHERE walletId not null), но
  // Prisma-тип этого не знает — узкое приведение прямо тут, без ещё одного if.
  const walletId = order.walletId!;
  const tenantId = order.zone.point.tenantId;

  const wallet = await prisma.abonementWallet.findUnique({ where: { id: walletId }, select: { name: true, phone: true } });
  if (wallet) {
    const links = await prisma.clientTelegramLink.findMany({ where: { tenantId, phone: wallet.phone } });
    const tenant = links.length > 0 ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }) : null;

    for (const link of links) {
      const s = BOT_STRINGS[link.language as Locale] ?? BOT_STRINGS.en;
      const text = [greetingLine(wallet.name, s), tenant ? `«${tenant.name}»` : null, s.orderExpiringSoon(order.number)]
        .filter(Boolean)
        .join("\n");
      await sendChatMessage(link.chatId, text).catch(() => {});
    }
  }

  // Гасим флаг независимо от того, был ли привязан Telegram-чат — иначе
  // планировщик находил бы этот же заказ на каждом тике до самого истечения.
  await prisma.ticketOrder.update({ where: { id: order.id }, data: { expiryReminderSentAt: new Date() } });
}
