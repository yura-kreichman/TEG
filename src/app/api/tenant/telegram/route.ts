import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { encryptSecret } from "@/lib/secret-crypto";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { telegramBotToken: true, telegramChatId: true },
  });

  return NextResponse.json({
    configured: Boolean(tenant?.telegramBotToken && tenant.telegramChatId),
    chatId: tenant?.telegramChatId ?? "",
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { botToken, chatId } = await request.json();
  if (typeof botToken !== "string" || !botToken.trim() || typeof chatId !== "string" || !chatId.trim()) {
    return NextResponse.json({ error: "Токен бота и chat_id обязательны" }, { status: 400 });
  }

  await prisma.tenant.update({
    where: { id: owner.tenantId },
    data: {
      telegramBotToken: encryptSecret(botToken.trim()),
      telegramChatId: chatId.trim(),
    },
  });

  return NextResponse.json({ ok: true });
}
