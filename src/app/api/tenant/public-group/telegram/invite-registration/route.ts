import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { getTenantPublicGroup, getClientBalanceDeepLink, sendInlineKeyboard, mapTelegramApiError } from "@/lib/telegram-bot";
import { BOT_STRINGS } from "@/lib/telegram-client-i18n";
import { isLocale } from "@/lib/locales";

// Разовый призыв уже состоящим в группе зарегистрироваться в боте (запрос
// пользователя 2026-07-25: "как стимулировать" — второй из двух рычагов,
// первый — автоприветствие новых участников, см. handleNewChatMembers в
// вебхуке). Bot API не даёт списка участников группы (приватность) — достать
// их можно только одним сообщением В САМУ группу, персонально не постучаться
// (бот не может первым написать в личку тому, кто не открывал с ним чат).
// Текст/кнопка — та же локализация, что и автоприветствие (BOT_STRINGS,
// язык — Tenant.locale, одна группа = один язык на всех).
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const group = await getTenantPublicGroup(owner.tenantId);
  if (!group?.chatId || group.chatStatus !== "active" || !group.enabled) {
    return NextResponse.json({ error: "Группа не подключена" }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { slug: true, locale: true } });
  if (!tenant?.slug) {
    return NextResponse.json({ error: "У тенанта нет публичного адреса" }, { status: 400 });
  }
  const deepLink = await getClientBalanceDeepLink(tenant.slug);
  if (!deepLink) {
    return NextResponse.json({ error: "Бот не настроен" }, { status: 400 });
  }

  const lang = isLocale(tenant.locale) ? tenant.locale : "ru";
  const s = BOT_STRINGS[lang];
  const result = await sendInlineKeyboard(group.chatId, s.groupCampaignText, [{ text: s.groupWelcomeButton, url: deepLink }]);
  if (!result.ok) {
    return NextResponse.json({ error: mapTelegramApiError(result) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
