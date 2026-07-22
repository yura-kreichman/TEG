import type { MetadataRoute } from "next";
import { getActivatedDevice } from "@/lib/operator-auth";

// Next.js допускает только ОДИН manifest.ts на весь ориджин — в корне app/,
// без под-путевых переопределений (в отличие от icon.tsx/favicon.ico) —
// поэтому start_url выбирается динамически по cookie активации устройства,
// а не два отдельных файла для Владельца/Оператора. Реальный прод-баг
// (найдено пользователем 2026-07-14): сотрудник ставил PWA с телефона,
// уже активированного как устройство точки, но ярлык всегда открывал "/" —
// экран входа ВЛАДЕЛЬЦА, а не Оператора. Из-за "запомненного устройства"
// владельца на том же телефоне (после того как он там разово вошёл для
// теста) ПИН Оператора затем сравнивался с ЛИЧНЫМ ПИН владельца и уходил
// в блокировку — путаница была не в БД, а именно в том, куда вела иконка.
// getActivatedDevice() не просто читает cookie, а проверяет в БД, что
// устройство реально activated=true — устаревшая/чужая cookie не уведёт
// на экран Оператора ошибочно.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const device = await getActivatedDevice();

  return {
    id: "/",
    name: "RentOS",
    short_name: "RentOS",
    description: "RentOS SaaS",
    start_url: device ? "/operator/login" : "/",
    display: "standalone",
    // display_override — браузер пробует значения по порядку, использует
    // первое поддерживаемое (запрос пользователя 2026-07-22):
    // - window-controls-overlay (Windows/desktop Chromium) — убирает ряд
    //   иконок браузера (пазл-расширения/загрузки/меню "⋮") из шапки
    //   установленного PWA-окна, оставляя только нативные
    //   свернуть/развернуть/закрыть (их подменить кастомными нельзя — это
    //   осознанное ограничение платформы против подделки чужого окна).
    // - fullscreen (Android) — без строки состояния/навигации системы,
    //   ближе к "весь экран" для терминала точки.
    // display (standalone) — обязательный fallback для браузеров без
    // display_override вовсе (Safari/Firefox).
    display_override: ["window-controls-overlay", "fullscreen", "standalone"],
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      {
        src: "/icon-library/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-library/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      // Несколько размеров maskable-иконки, не только 512 — некоторые
      // Android-лаунчеры (замечено на Samsung: "что-то добавляется, но
      // криво") берут ближайший подходящий размер для иконки на главном
      // экране, а не масштабируют один большой файл. Размеры 180/192/512
      // подсмотрены у Progressify (WP-плагин с рабочей PWA-установкой на
      // тех же устройствах, см. Progressify/includes/.../PwaAssets.php —
      // processMaskableIconVariants() генерирует ровно эти три размера).
      {
        src: "/icon-library/pwa/icon-180-maskable.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-library/pwa/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-library/pwa/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
