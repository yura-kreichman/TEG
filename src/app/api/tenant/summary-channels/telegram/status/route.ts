import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { getTenantChannel, isBotConfigured } from "@/lib/telegram-bot";

// Используется и для поллинга в шторке привязки (пока код не погашен ботом),
// и для карточки канала на экране "Сводки в Telegram".
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const channel = await getTenantChannel(owner.tenantId, "telegram");

  return NextResponse.json({
    botConfigured: isBotConfigured(),
    connected: !!channel && channel.chatStatus === "active",
    enabled: channel?.enabled ?? false,
    chatTitle: channel?.chatTitle ?? null,
  });
}
