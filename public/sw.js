// Не кэшируем ничего — это оперативное бизнес-приложение (деньги/счётчики),
// устаревший кэш был бы активным вредом. Единственная цель этого файла —
// удовлетворить критерий устанавливаемости Chrome ("есть fetch-обработчик"),
// без которого событие beforeinstallprompt (см. src/app/install-app-banner.tsx)
// вообще не срабатывает и баннер установки PWA никогда не появляется.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Пусто — запрос идёт в сеть как обычно, ничего не перехватываем.
});

// Push-уведомления (фидбек пользователя 2026-07-12, Владелец: сводки; расширено
// 2026-07-14 на Оператора: новые Задачи) — сервер шлёт JSON {title, body, url}
// через web-push, showNotification() обязателен внутри push-обработчика (иначе
// браузер сам покажет generic уведомление "это приложение обновилось в фоне").
// url кладём в data, чтобы notificationclick знал, куда открыть вкладку.
// Параллельно шлём postMessage всем УЖЕ открытым вкладкам — если у Оператора
// панель открыта на экране (не свёрнута), список задач должен обновиться сразу,
// а не только после тапа по OS-уведомлению (см. подписку на "message" в
// src/app/(app)/operator/page.tsx).
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "RentOS", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "RentOS";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: payload.body || "",
        icon: "/icon-library/pwa/icon-192.png",
        badge: "/icon-library/pwa/icon-192-maskable.png",
        data: { url: payload.url || "/" },
      }),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: "push-received", url: payload.url || "/" });
        }
      }),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.endsWith(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
