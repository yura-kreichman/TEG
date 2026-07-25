import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { getTenantPublicGroup, mapTelegramApiError, sendChatMessage } from "@/lib/telegram-bot";
import { isModuleEnabled } from "@/lib/tenant-modules";

export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  // Аудит 2026-07-25 — тот же принцип, что у .../bind.
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const group = await getTenantPublicGroup(owner.tenantId);
  if (!group?.chatId) {
    return NextResponse.json({ error: "Чат не подключён" }, { status: 400 });
  }

  const result = await sendChatMessage(group.chatId, "✅ RentOS подключён к этому чату");
  if (!result.ok) {
    return NextResponse.json({ error: mapTelegramApiError(result) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
