import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Ссылка-приглашение вводится Владельцем вручную (запрос пользователя
// 2026-07-24) — у бота нет прав администратора группы, чтобы сгенерировать
// её самому через Bot API, поэтому это отдельное поле, не часть флоу
// привязки чата (.../telegram/bind). Upsert — запись TenantPublicGroup
// может ещё не существовать, если Владелец сначала вставляет ссылку, а чат
// привязывает позже (или наоборот).
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const inviteLink: string | null = typeof body.inviteLink === "string" && body.inviteLink.trim() ? body.inviteLink.trim() : null;

  await prisma.tenantPublicGroup.upsert({
    where: { tenantId: owner.tenantId },
    create: { tenantId: owner.tenantId, inviteLink },
    update: { inviteLink },
  });

  return NextResponse.json({ ok: true, inviteLink });
}
