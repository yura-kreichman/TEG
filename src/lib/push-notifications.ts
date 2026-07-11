import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// Обёртка над web-push для отправки коротких Push-уведомлений владельцу
// (фидбек пользователя 2026-07-12) — параллель email-channel.ts/telegram-bot.ts:
// секреты только из env (VAPID-пара стабильна для всего окружения, в отличие
// от Telegram-токена/SMTP, которые настраиваются в БД per-тенант — подписка
// на push физически привязана к конкретной паре ключей, сменить её нельзя
// без потери всех существующих подписок браузеров).

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return ensureVapid();
}

export function getVapidPublicKey(): string | null {
  return ensureVapid() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// Рассылает всем активным подпискам тенанта — не бросает исключений на
// отдельную подписку (как и dispatch.ts для Telegram/email). Подписка,
// на которую браузер вернул 404/410 (endpoint больше не существует —
// пользователь снял разрешение или переустановил приложение), удаляется
// из БД сразу же — иначе на неё продолжали бы бессмысленно отправлять
// каждый раз, копя ошибки.
export async function sendPushToTenant(tenantId: string, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { tenantId } });
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("push send failed", { tenantId, endpoint: sub.endpoint, err });
        }
      }
    })
  );
}
