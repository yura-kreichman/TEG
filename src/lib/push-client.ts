"use client";

// Клиентская часть Web Push (фидбек пользователя 2026-07-12) — подписка на
// push через Service Worker (public/sw.js уже зарегистрирован в
// install-app-banner.tsx). Публичный VAPID-ключ берём с сервера
// (/api/push/vapid-public-key), а не из NEXT_PUBLIC_* — см. комментарий
// в самом роуте, почему. Роуты /api/push/* — общие для Владельца и Оператора
// (см. src/lib/push-identity.ts, добавлено 2026-07-14 для уведомлений о
// новых Задачах) — этот модуль не должен сам знать, кто сейчас залогинен.

// Стандартное преобразование base64url VAPID-ключа в Uint8Array, которого
// требует PushManager.subscribe() — единственный способ передать
// applicationServerKey без сторонней библиотеки.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export type SubscribeResult = { ok: true } | { ok: false; error: "notSupported" | "permissionDenied" | "serverError" };

export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, error: "notSupported" };

  const keyRes = await fetch("/api/push/vapid-public-key");
  if (!keyRes.ok) return { ok: false, error: "serverError" };
  const { publicKey } = await keyRes.json();

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast — lib.dom's newer Uint8Array<ArrayBufferLike> generic no longer
      // structurally matches ArrayBufferView<ArrayBuffer> that this option
      // expects, even though the actual value (a plain Uint8Array over a
      // regular, non-shared ArrayBuffer) is exactly what the Push API wants.
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });

    const subscribeRes = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!subscribeRes.ok) return { ok: false, error: "serverError" };

    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      return { ok: false, error: "permissionDenied" };
    }
    return { ok: false, error: "serverError" };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}
