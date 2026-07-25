import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getTenantPublicGroup, isBotConfigured, fetchChatInviteLink } from "@/lib/telegram-bot";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Используется и для поллинга в шторке привязки, и для карточки канала на
// экране "Сводки и сообщения" — тот же принцип, что у summary-channels
// status, просто читает TenantPublicGroup вместо TenantSummaryChannel.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  let group = await getTenantPublicGroup(owner.tenantId);

  // Ленивый подхват автоссылки (запрос пользователя 2026-07-24) — для чатов,
  // привязанных ДО того, как появилось авто-получение через Bot API (или
  // если оно не сработало сразу при привязке, например бота ещё не успели
  // сделать админом). Пробуем один раз, пока ссылки нет — сам метод Bot API
  // выпускает НОВУЮ ссылку при каждом вызове, повторный вызов уже с
  // заполненным полем не делаем.
  if (group?.chatId && group.chatStatus === "active" && !group.inviteLink) {
    const link = await fetchChatInviteLink(group.chatId);
    if (link) {
      group = await prisma.tenantPublicGroup.update({ where: { tenantId: owner.tenantId }, data: { inviteLink: link } });
    }
  }

  return NextResponse.json({
    botConfigured: await isBotConfigured(),
    // Реальный баг, найден пользователем 2026-07-25: выключенный тумблер
    // "Клиенты" (Настройки → Система) никак не влиял на эту страницу — и
    // сама страница, и пункт в списке "Сводки и сообщения" продолжали
    // работать так, будто модуль включён. Отдаём флаг клиенту, чтобы
    // страница/пункт списка могли спрятаться, тот же принцип, что уже
    // применён к API самих кошельков/абонементов.
    clientsEnabled: await isModuleEnabled(owner.tenantId, "clientsEnabled"),
    connected: !!group && group.chatStatus === "active",
    enabled: group?.enabled ?? true,
    chatTitle: group?.chatTitle ?? null,
    inviteLink: group?.inviteLink ?? null,
    announceNewZones: group?.announceNewZones ?? false,
    announceNewPoints: group?.announceNewPoints ?? false,
    announceNewAssets: group?.announceNewAssets ?? false,
  });
}
