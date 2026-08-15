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
  // Два права, и оба под конкретную функцию бота именно в КЛИЕНТСКОЙ группе:
  //   invite_users    — без него exportChatInviteLink отвечает отказом, и
  //                     тогда нет ни ссылки-приглашения, ни ответа /join, ни
  //                     кнопки «Группа в Telegram» на лендинге;
  //   delete_messages — бот стирает своё приветствие новому участнику, когда
  //                     тот перешёл по кнопке в бота (webhook, cleanupPending-
  //                     WelcomeMessage): иначе группа зарастает приветствиями.
  //                     По документации на СВОИ сообщения права не нужны, но
  //                     удаление у нас best-effort и ошибки глушит — молчаливый
  //                     отказ в супергруппе мы бы не заметили, а мусор копился
  //                     бы в клиентской группе тенанта.
  // Рабочему чату сотрудников (summary-channels) не нужно ни то, ни другое:
  // там бот только отправляет сводки.
  const deepLink = await getBindDeepLink(code, "invite_users+delete_messages");

  return NextResponse.json({ code, deepLink, expiresAt });
}
