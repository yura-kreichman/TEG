import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { getSystemSettingsConfig } from "@/lib/system-settings";

// Обёртка над web-push для отправки коротких Push-уведомлений владельцу
// (фидбек пользователя 2026-07-12) — параллель email-channel.ts/telegram-bot.ts:
// VAPID-пара хранится в SystemSettings (БД, редактируется в /admin/settings —
// "сделай настройки для Админа для Push уведомлений"), .env остаётся тихим
// фоллбэком, как у остальных платформенных секретов (см. system-settings.ts).
// Читаем конфиг заново на каждый вызов (не кэшируем в памяти процесса) —
// иначе смена ключей в /admin/settings не подхватилась бы без рестарта
// контейнера; сам запрос — один индексированный findUnique, не дорого.

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

async function loadVapidConfig(): Promise<VapidConfig | null> {
  const { vapid } = await getSystemSettingsConfig();
  const publicKey = vapid.publicKey || process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = vapid.privateKey || process.env.VAPID_PRIVATE_KEY || "";
  const subject = vapid.subject || process.env.VAPID_SUBJECT || "";
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export async function isPushConfigured(): Promise<boolean> {
  return (await loadVapidConfig()) !== null;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const config = await loadVapidConfig();
  return config?.publicKey ?? null;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

// Общая рассылка на набор уже загруженных подписок — не бросает исключений
// на отдельную подписку (как и dispatch.ts для Telegram/email). Подписка, на
// которую браузер вернул 404/410 (endpoint больше не существует — пользователь
// снял разрешение или переустановил приложение), удаляется из БД сразу же —
// иначе на неё продолжали бы бессмысленно отправлять каждый раз, копя ошибки.
// Возвращает число реально успешных отправок — нужно для "Тест" (см. ниже),
// чтобы отличить "ключей нет" от "подписок нет" от "все подписки мертвы".
async function sendToSubscriptions(subscriptions: PushSubscriptionRow[], payload: PushPayload): Promise<number> {
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("push send failed", { endpoint: sub.endpoint, err });
        }
      }
    })
  );
  return sent;
}

export async function sendPushToTenant(tenantId: string, payload: PushPayload): Promise<void> {
  const config = await loadVapidConfig();
  if (!config) return;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const subscriptions = await prisma.pushSubscription.findMany({ where: { tenantId } });
  if (subscriptions.length === 0) return;
  await sendToSubscriptions(subscriptions, payload);
}

export type SendTestPushResult =
  | { ok: true; sent: number }
  | { ok: false; error: "notConfigured" | "noSubscriptions" | "allFailed" };

// "Тест" (фидбек пользователя 2026-07-12: "добавить работающую кнопку Тест
// уведомлений") — только на подписки ЭТОГО владельца (userId), не всего
// тенанта: тест нужен, чтобы проверить своё устройство, а не разбудить
// пуш-уведомлением чужие устройства других Owner-аккаунтов тенанта (если
// их несколько).
export async function sendTestPushToUser(userId: string): Promise<SendTestPushResult> {
  const config = await loadVapidConfig();
  if (!config) return { ok: false, error: "notConfigured" };
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return { ok: false, error: "noSubscriptions" };

  const sent = await sendToSubscriptions(subscriptions, {
    title: "🔔 Тестовое уведомление",
    body: "Если вы это видите — push-уведомления работают.",
  });
  return sent > 0 ? { ok: true, sent } : { ok: false, error: "allFailed" };
}
