import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendChatMessage } from "@/lib/telegram-bot";

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

  if (update.message?.text) {
    await handleStartMessage(update.message);
  } else if (update.my_chat_member) {
    await handleMyChatMember(update.my_chat_member);
  }

  // Telegram ждёт 200 в любом случае — иначе ретраит доставку того же update.
  return NextResponse.json({ ok: true });
}

async function handleStartMessage(message: { text: string; chat: { id: number; title?: string; type: string } }) {
  const match = message.text.match(/^\/start(?:@\w+)?\s+(\S+)/);
  if (!match) return;
  const code = match[1].toUpperCase();

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
