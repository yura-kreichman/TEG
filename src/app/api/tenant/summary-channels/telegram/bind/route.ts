import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { createBindCode, getBindDeepLink, isBotConfigured } from "@/lib/telegram-bot";

// Создаёт одноразовый код привязки (docs/spec/telegram-summaries.md) — фронт
// открывает deepLink, а параллельно опрашивает .../status до появления чата.
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isBotConfigured())) {
    return NextResponse.json({ error: "Бот не настроен" }, { status: 503 });
  }

  const { code, expiresAt } = await createBindCode(owner.tenantId);
  const deepLink = getBindDeepLink(code);

  return NextResponse.json({ code, deepLink, expiresAt });
}
