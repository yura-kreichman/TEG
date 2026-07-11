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
