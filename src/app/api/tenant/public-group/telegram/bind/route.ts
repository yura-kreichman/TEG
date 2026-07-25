import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { createBindCode, getBindDeepLink, isBotConfigured } from "@/lib/telegram-bot";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Тот же принцип, что /api/tenant/summary-channels/telegram/bind — код
// привязки + ?startgroup= ссылка (без ручного поиска Group Id, запрос
// пользователя 2026-07-24), только purpose="public_group" пишет chatId в
// TenantPublicGroup, не в TenantSummaryChannel (см. webhook/route.ts).
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  // Серверная проверка тумблера "Клиенты" (аудит 2026-07-25) — без неё
  // выключенный модуль всё равно позволял бы начать привязку публичной
  // группы, тот же принцип, что уже применён к API кошельков/абонементов.
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  if (!(await isBotConfigured())) {
    return NextResponse.json({ error: "Бот не настроен" }, { status: 503 });
  }

  const { code, expiresAt } = await createBindCode(owner.tenantId, "public_group");
  const deepLink = await getBindDeepLink(code);

  return NextResponse.json({ code, deepLink, expiresAt });
}
