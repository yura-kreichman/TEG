import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

const BOOLEAN_FIELDS = ["enabled", "announceNewZones", "announceNewPoints", "announceNewAssets"] as const;
type BooleanField = (typeof BOOLEAN_FIELDS)[number];

// Тумблеры настроек группы — "вкл/выкл" самой рассылки (тот же принцип, что
// /api/tenant/summary-channels/telegram: можно временно приостановить,
// не отвязывая чат) и три отдельных автоанонса новых зон/точек/активов
// (запрос пользователя 2026-07-24: "отдельно на каждую сущность"). Upsert,
// не update — предпочтения анонсов должны быть настраиваемы ДО того, как
// чат вообще подключён (запрос того же дня: "несмотря на то, что он не
// подключён ещё"), запись TenantPublicGroup тогда может ещё не существовать.
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  // Аудит 2026-07-25 — тот же принцип, что у .../bind.
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: Partial<Record<BooleanField, boolean>> & { inviteLink?: string | null } = {};
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") patch[field] = body[field];
  }
  // Ручной ввод ссылки-приглашения — реальный баг, найден пользователем
  // 2026-07-26: fetchChatInviteLink срабатывает только если бота добавили
  // с правом приглашать по ссылке; когда этого права нет, inviteLink
  // навсегда остаётся пустым, а этот PATCH раньше вообще не принимал такое
  // поле — на UI была готовая форма ручного ввода (TelegramConnectSheet),
  // но её никто не мог сохранить.
  if (typeof body.inviteLink === "string" || body.inviteLink === null) {
    patch.inviteLink = body.inviteLink;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
  }

  await prisma.tenantPublicGroup.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, ...patch },
    update: patch,
  });

  return NextResponse.json({ ok: true });
}
