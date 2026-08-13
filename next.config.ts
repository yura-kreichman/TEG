import type { NextConfig } from "next";

// CSP переехала в src/lib/csp.ts и выдаётся из src/proxy.ts (аудит
// 2026-08-13): она больше не константа, а строка со свежим одноразовым nonce
// на каждый ответ, а статические headers() из этого файла nonce сформировать
// не могут. Здесь остались только заголовки, у которых нет переменной части.

const nextConfig: NextConfig = {
  // pdfkit грузит свои .afm файлы шрифтов по пути относительно __dirname во
  // время выполнения (docs/spec/07-instructions.md, PDF-генерация) — бандлинг
  // Next в Route Handler ломает этот путь ("C:\ROOT\node_modules\pdfkit\..."),
  // не входит в короткий список автовынесенных пакетов Next (sharp/prisma и
  // т.п. — там уже есть, поэтому раньше это не всплывало). serverExternalPackages
  // заставляет грузить пакет через нативный require из настоящего node_modules.
  serverExternalPackages: ["pdfkit"],
  poweredByHeader: false,
  // Публичный путь Лендинга перенесён с /site/[slug] на /s/[slug] (решение
  // пользователя 2026-07-14, по аналогии с коротким префиксом Инструктажей
  // /i/...). Старый префикс уже был проиндексирован/расшарен (JSON-LD,
  // sitemap.xml, Google/Яндекс верификация настраивались в тот же день под
  // /site/) — постоянный 301, не молчаливый 404, чтобы не терять накопленный
  // SEO-вес и не ломать уже сохранённые ссылки. redirects() выполняется
  // РАНЬШЕ Proxy (докс Next.js: "redirects runs before Proxy"), так что
  // src/proxy.ts (который теперь матчит только /s/) старый путь не увидит
  // вообще — редирект отработает до него.
  async redirects() {
    return [
      { source: "/site/:slug/preview/:token", destination: "/s/:slug/preview/:token", permanent: true },
      { source: "/site/:slug", destination: "/s/:slug", permanent: true },
    ];
  },
  // Загруженные файлы (public/uploads/<tenantId>/...) — единственная папка в
  // public/, которая наполняется ВО ВРЕМЯ РАБОТЫ приложения, а не при сборке.
  // Next.js снимает список файлов public/ один раз при старте процесса, поэтому
  // всё загруженное после старта он отдаёт как 404 — и хотя браузеру этот путь
  // отдаёт nginx-алиасом, оптимизатор /_next/image ходит за исходником внутрь
  // себя, мимо nginx, и упирается ровно в это (реальный баг на проде
  // 2026-08-02, подробности в src/app/api/uploads/[...path]/route.ts).
  //
  // afterFiles, не beforeFiles: рерайты этой группы проверяются ПОСЛЕ статики
  // (докс Next.js, порядок роутинга, шаг 6) — файлы, попавшие в снимок при
  // старте, продолжают отдаваться быстрым статическим путём, и только промах
  // доезжает до роут-хендлера, который читает диск заново на каждый запрос.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [{ source: "/uploads/:path*", destination: "/api/uploads/:path*" }],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Аппаратные API, которые приложению не нужны ни на одной странице
          // (аудит 2026-08-13). Не «дыра» сама по себе — страховка на случай
          // внедрённого скрипта или встроенного iframe: без неё украденный
          // скрипт может спросить у браузера камеру/микрофон/геопозицию от
          // имени нашего домена, и человек увидит запрос, которому доверяет.
          // Проверено грепом, что ни одного из этих API в проекте нет: сканера
          // QR в PWA не существует, а печать и Web Push этой политикой не
          // задеваются. Если когда-нибудь появится сканер — camera отсюда
          // придётся убрать, иначе он молча не запустится.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), midi=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
