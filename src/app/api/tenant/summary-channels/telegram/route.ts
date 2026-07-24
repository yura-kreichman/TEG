import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getTenantChannel } from "@/lib/telegram-bot";

// Тумблер "вкл/выкл" на списке каналов — независим от факта привязки чата
// (chatStatus): можно временно приостановить доставку, не отвязывая чат.
// Настраивается ДАЖЕ ДО подключения (запрос пользователя 2026-07-24:
// "настройки... должны быть независимо от того, подключена ли реальная
// группа или нет") — если записи ещё нет, создаём её заранее (chatId
// проставится позже, самой привязкой).
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { enabled } = await request.json();
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled должен быть булевым" }, { status: 400 });
  }

  const channel = await getTenantChannel(owner.tenantId, "telegram");
  if (channel) {
    await prisma.tenantSummaryChannel.update({ where: { id: channel.id }, data: { enabled } });
  } else {
    await prisma.tenantSummaryChannel.create({
      data: { tenantId: owner.tenantId, channelType: "telegram", enabled },
    });
  }

  return NextResponse.json({ ok: true });
}
