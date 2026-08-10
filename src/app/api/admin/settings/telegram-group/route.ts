import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { getSystemSettingsConfig, patchSystemSettingsConfig } from "@/lib/system-settings";
import { generateBindCode, getBindDeepLink, isBotConfigured, sendChatMessage } from "@/lib/telegram-bot";

// Подключение группы Super Admin'а к уведомлениям платформы (запрос
// пользователя 2026-08-10). Тот же механизм, что у Владельцев: одноразовый код
// + deep-link "?startgroup=", бот ловит его в группе и сам записывает chatId
// (см. ветку purpose "platform" в api/telegram/webhook). Разница только в том,
// что у платформенного кода нет тенанта, а чат сохраняется в SystemSettings.
const BIND_CODE_TTL_MS = 15 * 60 * 1000;

export async function POST() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  if (!(await isBotConfigured())) {
    return NextResponse.json({ error: "Сначала укажите токен бота" }, { status: 400 });
  }

  const code = generateBindCode();
  const expiresAt = new Date(Date.now() + BIND_CODE_TTL_MS);
  await prisma.telegramBindCode.create({ data: { code, expiresAt, purpose: "platform" } });

  const link = await getBindDeepLink(code);
  return NextResponse.json({ code, expiresAt, link });
}

/** Отвязка группы — уведомления перестают уходить, тумблеры остаются как были. */
export async function DELETE() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { adminNotifications } = await getSystemSettingsConfig();
  if (adminNotifications.chatId) {
    await sendChatMessage(adminNotifications.chatId, "Уведомления RentOS отключены от этого чата").catch(() => {});
  }
  await patchSystemSettingsConfig({ adminNotifications: { ...adminNotifications, chatId: "", chatTitle: "" } });

  return NextResponse.json({ ok: true });
}

/** Проверочное сообщение — тот же путь, которым уходят настоящие уведомления. */
export async function PUT() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { adminNotifications } = await getSystemSettingsConfig();
  if (!adminNotifications.chatId) {
    return NextResponse.json({ error: "Группа не подключена" }, { status: 400 });
  }

  const result = await sendChatMessage(adminNotifications.chatId, "✅ Проверка связи — уведомления платформы работают");
  if (!result.ok) {
    return NextResponse.json({ error: result.description ?? "Не удалось отправить сообщение" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
