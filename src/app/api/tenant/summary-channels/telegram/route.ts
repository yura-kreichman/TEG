import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getTenantChannel } from "@/lib/telegram-bot";

// Тумблер "вкл/выкл" на списке каналов — независим от факта привязки чата
// (chatStatus): можно временно приостановить доставку, не отвязывая чат.
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
  if (!channel) {
    return NextResponse.json({ error: "Чат не подключён" }, { status: 400 });
  }

  await prisma.tenantSummaryChannel.update({ where: { id: channel.id }, data: { enabled } });

  return NextResponse.json({ ok: true });
}
