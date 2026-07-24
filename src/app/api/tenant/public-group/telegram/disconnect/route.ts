import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getTenantPublicGroup } from "@/lib/telegram-bot";

// "Отключить чат" — обнуляет chatId/chatTitle (та же семантика, что у
// summary-channels disconnect), inviteLink НЕ трогает — это отдельная от
// привязки чата настройка, владелец мог ввести её заранее.
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const group = await getTenantPublicGroup(owner.tenantId);
  if (!group) {
    return NextResponse.json({ ok: true });
  }

  await prisma.tenantPublicGroup.update({
    where: { id: group.id },
    data: { chatStatus: "inactive", chatId: null, chatTitle: null },
  });

  return NextResponse.json({ ok: true });
}
