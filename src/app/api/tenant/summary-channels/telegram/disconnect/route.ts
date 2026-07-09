import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getTenantChannel } from "@/lib/telegram-bot";

// "Отключить чат" в шторке — жёстче, чем тумблер enabled на списке: обнуляет
// привязку целиком, чтобы карточка снова показывала "не подключено" и
// предлагала пройти привязку заново. Из чата в Telegram бота НЕ удаляет —
// это отдельное действие владельца в самом Telegram, если он этого хочет.
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const channel = await getTenantChannel(owner.tenantId, "telegram");
  if (!channel) {
    return NextResponse.json({ ok: true });
  }

  await prisma.tenantSummaryChannel.update({
    where: { id: channel.id },
    data: { enabled: false, chatStatus: "inactive", chatId: null, chatTitle: null },
  });

  return NextResponse.json({ ok: true });
}
