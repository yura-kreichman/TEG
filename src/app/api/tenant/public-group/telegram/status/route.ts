import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { getTenantPublicGroup, isBotConfigured } from "@/lib/telegram-bot";

// Используется и для поллинга в шторке привязки, и для карточки канала на
// экране "Сводки и сообщения" — тот же принцип, что у summary-channels
// status, просто читает TenantPublicGroup вместо TenantSummaryChannel.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const group = await getTenantPublicGroup(owner.tenantId);

  return NextResponse.json({
    botConfigured: await isBotConfigured(),
    connected: !!group && group.chatStatus === "active",
    enabled: group?.enabled ?? true,
    chatTitle: group?.chatTitle ?? null,
    inviteLink: group?.inviteLink ?? null,
    announceNewZones: group?.announceNewZones ?? false,
    announceNewPoints: group?.announceNewPoints ?? false,
    announceNewAssets: group?.announceNewAssets ?? false,
  });
}
