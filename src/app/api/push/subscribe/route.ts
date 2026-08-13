import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePushIdentity } from "@/lib/push-identity";

// Единый роут для Владельца и Оператора (см. src/lib/push-identity.ts) —
// заменяет прежний /api/tenant/push/subscribe, который умел только Owner'а.
// Тело — стандартный PushSubscriptionJSON из браузера
// (registration.pushManager.subscribe(...).toJSON()). endpoint уникален
// глобально (см. schema.prisma) — upsert по нему переиспользует ту же
// строку, если это устройство уже было подписано.
export async function POST(request: Request) {
  const identity = await resolvePushIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return NextResponse.json({ error: "Некорректные данные подписки" }, { status: 400 });
  }

  const roleData =
    "userId" in identity
      ? { userId: identity.userId, operatorId: null }
      : { userId: null, operatorId: identity.operatorId };

  // endpoint уникален глобально, поэтому upsert по нему мог ПЕРЕХВАТИТЬ чужую
  // строку (аудит 2026-08-13): зная endpoint чужой подписки (это URL push-
  // сервиса, он попадает в логи, отладку, экспорт настроек браузера), любой
  // авторизованный пользователь другого тенанта переписывал её на себя. Жертва
  // переставала получать свои уведомления, а её браузер начинал получать чужие
  // — то есть утечка содержимого уведомлений между тенантами.
  //
  // Существующую строку теперь можно обновить, только если она уже принадлежит
  // тому же лицу. Чужую не трогаем и отвечаем 409, а не молча игнорируем:
  // тихий «ок» на неудавшуюся подписку означал бы, что PWA считает себя
  // подписанной, а уведомления не приходят.
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint },
    select: { userId: true, operatorId: true },
  });
  if (
    existing &&
    (existing.userId !== roleData.userId || existing.operatorId !== roleData.operatorId)
  ) {
    return NextResponse.json({ error: "Эта подписка принадлежит другому аккаунту" }, { status: 409 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { tenantId: identity.tenantId, endpoint, p256dh, auth, ...roleData },
    update: { tenantId: identity.tenantId, p256dh, auth, ...roleData },
  });

  return NextResponse.json({ ok: true });
}
