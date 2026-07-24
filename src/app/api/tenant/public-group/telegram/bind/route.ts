import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { createBindCode, getBindDeepLink, isBotConfigured } from "@/lib/telegram-bot";

// Тот же принцип, что /api/tenant/summary-channels/telegram/bind — код
// привязки + ?startgroup= ссылка (без ручного поиска Group Id, запрос
// пользователя 2026-07-24), только purpose="public_group" пишет chatId в
// TenantPublicGroup, не в TenantSummaryChannel (см. webhook/route.ts).
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isBotConfigured())) {
    return NextResponse.json({ error: "Бот не настроен" }, { status: 503 });
  }

  const { code, expiresAt } = await createBindCode(owner.tenantId, "public_group");
  const deepLink = await getBindDeepLink(code);

  return NextResponse.json({ code, deepLink, expiresAt });
}
