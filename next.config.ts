import type { NextConfig } from "next";

// Security-заголовки (найдено внешним SEO/security-отчётом sitechecker.pro
// 2026-07-14: "Defence against XSS/clickjacking/MIME-sniffing attacks is not
// implemented", "Web server discloses its version"). Сайт полностью
// self-hosted — ни одного внешнего CDN/шрифта/аналитики (докс: собственная
// статистика посещений, Inter грузится через next/font, не Google Fonts) —
// единственный легитимный внешний источник на всём проекте: YouTube-плеер
// секции видео Лендинга (public/landing-video.js, youtube-nocookie.com,
// создаётся по клику, не в разметке). Это делает CSP короткой и безопасной
// для site-wide применения, а не только для /s/[slug].
// 'unsafe-inline' в style-src ОБЯЗАТЕЛЕН: next/image сам расставляет inline
// style на каждый <img> (position/aspect для fill), плюс собственный код
// местами использует style={{...}} (например ZoneIconGlyph, mask-image) —
// без unsafe-inline это всё сломалось бы визуально на каждой странице.
// 'unsafe-eval' в script-src — ТОЛЬКО в dev (Turbopack HMR/Fast Refresh на
// некоторых платформах использует eval), в проде не нужен и не включён.
const isDev = process.env.NODE_ENV !== "production";
const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data:`,
  `font-src 'self' data:`,
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  `frame-src 'self' https://www.youtube-nocookie.com`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
]
  .join("; ")
  .concat(";");

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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
