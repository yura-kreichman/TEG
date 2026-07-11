import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Тело — стандартный PushSubscriptionJSON из браузера
// (registration.pushManager.subscribe(...).toJSON()). endpoint уникален
// глобально (см. schema.prisma) — upsert по нему переиспользует ту же
// строку, если это устройство уже было подписано (например, ключи auth/p256dh
// browser иногда меняет при повторной подписке).
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return NextResponse.json({ error: "Некорректные данные подписки" }, { status: 400 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { tenantId: owner.tenantId, userId: owner.user.id, endpoint, p256dh, auth },
    update: { userId: owner.user.id, tenantId: owner.tenantId, p256dh, auth },
  });

  return NextResponse.json({ ok: true });
}
