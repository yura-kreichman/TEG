// Content-Security-Policy. Появилась после внешнего SEO/security-отчёта
// sitechecker.pro 2026-07-14 ("Defence against XSS/clickjacking/MIME-sniffing
// attacks is not implemented"). Сайт полностью self-hosted — ни одного внешнего
// CDN/шрифта/аналитики (докс: собственная статистика посещений, Inter грузится
// через next/font, не Google Fonts) — единственный легитимный внешний источник
// на всём проекте: YouTube-плеер секции видео Лендинга (public/landing-video.js,
// youtube-nocookie.com, создаётся по клику, не в разметке). Это делает политику
// короткой и безопасной для применения на весь сайт, а не только на /s/[slug].
//
// script-src: nonce вместо 'unsafe-inline' (аудит 2026-08-13). С 'unsafe-inline'
// политика не мешала выполнить внедрённый скрипт вообще ничем — то есть от
// XSS не защищала, оставаясь защитой только от загрузки чужих доменов. Теперь
// каждый ответ несёт свежий одноразовый nonce (см. proxy.ts), Next сам
// проставляет его своим бутстрап-скриптам, читая CSP из заголовков запроса
// (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md),
// а наши собственные <script> получают его явным пропсом.
//
// 'strict-dynamic' СОЗНАТЕЛЬНО не включён, хотя пример в доках Next с ним:
// он отменяет действие списка источников, то есть 'self' перестаёт работать, и
// обычные <script src="/landing-*.js"> на Лендинге пришлось бы либо тоже
// пронумеровать, либо потерять. Выигрыш от strict-dynamic тут нулевой (чужих
// доменов в script-src и так нет), а цена — лишняя связанность вёрстки с CSP.
//
// 'unsafe-inline' в style-src ОБЯЗАТЕЛЕН и остаётся: next/image сам расставляет
// inline style на каждый <img> (position/aspect для fill), плюс собственный код
// местами использует style={{...}} (например ZoneIconGlyph, mask-image) — без
// него это сломалось бы визуально на каждой странице. Инлайновые стили — это
// не тот же класс риска, что инлайновые скрипты: выполнить код через них нельзя.
//
// 'unsafe-eval' — ТОЛЬКО в dev (Turbopack HMR/Fast Refresh на некоторых
// платформах использует eval), в проде не нужен и не включён.
export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
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
}

// Заголовок, которым proxy.ts передаёт nonce в рендер. Серверные компоненты
// читают его через headers() — см. lib/nonce.ts.
export const NONCE_HEADER = "x-nonce";
