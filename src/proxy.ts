import { randomUUID } from "crypto";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { buildCsp, NONCE_HEADER } from "@/lib/csp";
import { getSubscriptionGateState } from "@/lib/subscription-gate";
import { verifySessionToken } from "@/lib/session-crypto";
import { prisma } from "@/lib/prisma";
import { resolveTenantBySlug } from "@/lib/landing/resolve-tenant";
import { isBotUserAgent, recordLandingVisit, pruneOldVisitorHashes } from "@/lib/landing/stats";
import { isRateLimited } from "@/lib/landing/rate-limit";
import { getClientIp } from "@/lib/instructions/request-ip";
import {
  isLocale,
  PRE_AUTH_LOCALE_COOKIE,
  PRE_AUTH_LOCALE_MAX_AGE,
  LINK_LOCALE_HEADER,
} from "@/lib/locales";

// Marks pre-auth screens so resolveLocale() (src/lib/i18n.ts) ignores any
// lingering session cookie for language purposes on these paths — found
// 2026-07-10: testing the login-page language picker while already logged in
// as Owner/Admin/Operator in the same browser made the switcher look broken,
// since the real account's locale always won over the pre-auth cookie. On
// these paths specifically, the visitor isn't "using the app as that
// account" yet, so their picked language should always show.
//
// Named `proxy.ts` (not `middleware.ts`) — this Next.js version deprecated
// and renamed the file convention, see node_modules/next/dist/docs/.../proxy.md.
// Also defaults to the Node.js runtime (unlike the old Edge-only Middleware),
// which is what makes the Prisma lookup below possible from here at all.
const PRE_AUTH_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/set-pin",
  "/activate-device",
  "/operator/login",
  "/admin/login",
];

// "/i/[tenantSlug]/[instructionSlug]" (docs/spec/07-instructions.md) НЕ
// входит в этот список — язык этой страницы намеренно язык ТЕНАНТА
// (уточнение пользователя 2026-07-12), не визитёра и не его сессии: сама
// страница резолвит и передаёт dict явно (см. её page.tsx), сессия читателя
// в выбор языка там вообще не участвует, ни в какую сторону.

// Реальная блокировка биллинга (docs/spec/06-super-admin.md, доп. решение
// 2026-07-12) — Owner с просроченной/приостановленной подпиской переходит в
// режим "только чтение": любой мутирующий запрос к его API отклоняется
// здесь, в одном центральном месте, а не правкой полусотни owner-роутов по
// отдельности. Баннер, который об этом сообщает — SubscriptionBanner в
// OwnerShell, читает статус отдельным GET (не блокируется этой же проверкой,
// т.к. GET/HEAD никогда не проверяются). PWA Оператора НЕ затрагивается
// (осознанное решение пользователя — операторы работают на точке весь день,
// останавливать приём оплат/сдачу итогов из-за просрочки счёта нельзя): у
// operator-сессий нет cookie "session" вообще (свой отдельный механизм), так
// что эта проверка их запросы просто не увидит.
const SUBSCRIPTION_BLOCKED_STATUSES = new Set(["expired", "suspended"]);
// Пути, которые обязаны работать даже при заблокированной подписке — иначе
// владелец не сможет ни выйти из аккаунта, ни (в будущем) оплатить. Admin
// использует отдельную cookie (admin_session), эта проверка его и так не
// затронет, но путь исключён явно — ради производительности, не корректности.
const SUBSCRIPTION_GATE_EXEMPT_PREFIXES = ["/api/auth/", "/api/webhooks/", "/api/admin/"];

// /s/{slug} (Лендинг) и /i/{slug}/{instructionSlug} (Инструктажи) вместе:
// docs/spec/08-landing.md — с 2026-07-13 Tenant.slug общий и редактируемый,
// поэтому 301 на актуальный слаг при попадании в TenantOldSlug нужен обоим
// путям (см. src/lib/landing/resolve-tenant.ts). Сбор статистики/rate limit
// — только для /s/, GET, не превью, не боты. Префикс /s/ (не /site/) —
// решение пользователя 2026-07-14; 301 со старого префикса живёт в
// next.config.ts redirects() и срабатывает РАНЬШЕ этого файла (Next.js:
// "redirects runs before Proxy"), так что здесь старый путь уже не встретится.
const SITE_PATH_RE = /^\/s\/([^/]+)\/?$/;
const INSTRUCTION_PATH_RE = /^\/i\/([^/]+)\/([^/]+)\/?$/;
// /s/{slug}/preview/{token} — не входит в SITE_PATH_RE (та же строка
// комментария выше: сбор статистики/rate limit "не превью"), но полное
// отсутствие throttling здесь было отдельной, самостоятельной дырой (аудит
// 2026-07-27): guessing/brute-force токена черновика вообще не тормозился.
// Считать визиты сюда по-прежнему не нужно — только троттлить попытки.
const PREVIEW_PATH_RE = /^\/s\/([^/]+)\/preview\/([^/]+)\/?$/;

// Запрет индексации всего приложения (запрос владельца 2026-08-15: «закрой
// my.rentos365.app от всех ботов, чтобы его ничего не дёргало»). robots.txt
// это уже просил — но просил именно НЕ ХОДИТЬ, а адрес, на который ведёт
// внешняя ссылка, поисковик может показать в выдаче и не заходя на него.
// X-Robots-Tag закрывает вторую половину: страница, которую бот всё-таки
// скачал (meta-externalagent в логах ходит по /register вопреки robots.txt),
// в индекс не попадёт.
//
// Исключения — ровно три, и все обязательные:
//   /s/{slug}    — Лендинг тенанта, docs/spec/08-landing.md прямо требует
//                  индексации, sitemap, JSON-LD и Lighthouse SEO >= 90;
//                  закрыть его значит отменить модуль целиком;
//   /robots.txt  — правила обхода, сами себя запрещать не должны;
//   /sitemap.xml — карта живых лендингов для поисковика.
// Черновик лендинга /s/{slug}/preview/{token} исключением НЕ является: это
// неопубликованная страница по секретной ссылке, ей в выдаче делать нечего.
// Ассеты (_next/static, _next/image, favicon.ico) сюда не доходят вообще —
// они исключены matcher'ом внизу файла.
const ROBOTS_TAG = "noindex, nofollow, noarchive, nosnippet, noimageindex";
const ROBOTS_TAG_EXEMPT = ["/robots.txt", "/sitemap.xml"];

function setRobotsTag(request: NextRequest, response: NextResponse) {
  const { pathname } = request.nextUrl;
  const isPublicLanding = pathname.startsWith("/s/") && !PREVIEW_PATH_RE.test(pathname);
  if (isPublicLanding || ROBOTS_TAG_EXEMPT.includes(pathname)) return;
  response.headers.set("X-Robots-Tag", ROBOTS_TAG);
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Одноразовый nonce на каждый ответ (аудит 2026-08-13) — им заменён
  // 'unsafe-inline' в script-src, см. lib/csp.ts. Кладём его в заголовки
  // ЗАПРОСА в двух видах: x-nonce читают наши серверные компоненты
  // (lib/nonce.ts), а сам заголовок Content-Security-Policy разбирает Next и
  // сам проставляет nonce своим бутстрап-скриптам — этот механизм описан в
  // node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md и
  // работает только если политика видна в ЗАПРОСЕ, не только в ответе.
  const nonce = randomUUID();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // Один выход для всех return'ов ниже: политика обязана быть на КАЖДОМ
  // ответе, а забыть её на одной ветке — ровно тот способ, которым такие
  // заголовки и теряются.
  const withCsp = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    setRobotsTag(request, response);
    return response;
  };

  const { pathname } = request.nextUrl;

  const previewMatch = PREVIEW_PATH_RE.exec(pathname);
  if (previewMatch && request.method === "GET") {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      return withCsp(new NextResponse("Too Many Requests", { status: 429 }));
    }
  }

  const siteMatch = SITE_PATH_RE.exec(pathname);
  const instructionMatch = INSTRUCTION_PATH_RE.exec(pathname);
  if (siteMatch || instructionMatch) {
    const slug = (siteMatch ?? instructionMatch)![1]!;
    const resolved = await resolveTenantBySlug(slug);

    if (resolved.kind === "redirect") {
      const url = request.nextUrl.clone();
      url.pathname = siteMatch ? `/s/${resolved.currentSlug}` : `/i/${resolved.currentSlug}/${instructionMatch![2]}`;
      return withCsp(NextResponse.redirect(url, 301));
    }

    if (siteMatch && resolved.kind === "found" && request.method === "GET") {
      const ip = getClientIp(request);
      if (isRateLimited(ip)) {
        return withCsp(new NextResponse("Too Many Requests", { status: 429 }));
      }

      const userAgent = request.headers.get("user-agent") ?? "";
      const isPreview = request.nextUrl.searchParams.has("preview");
      // Реальные визиты только: не превью-режим владельца, не бот, не выше
      // rate limit (уже проверено выше), лендинг фактически опубликован —
      // считаем в фоне через waitUntil, не задерживая ответ.
      if (!isPreview && !isBotUserAgent(userAgent)) {
        const tenantId = resolved.tenantId;
        const referer = request.headers.get("referer");
        const ownOrigin = request.nextUrl.hostname;
        event.waitUntil(
          (async () => {
            const landing = await prisma.landing.findUnique({
              where: { tenantId },
              select: { id: true, status: true, tenant: { select: { timezone: true } } },
            });
            if (landing?.status !== "published") return;
            await recordLandingVisit({
              landingId: landing.id,
              timezone: landing.tenant.timezone,
              ip,
              userAgent,
              referer,
              ownOrigin,
            });
            // Best-effort чистка старых хэшей (докс, LandingVisitorSeen) —
            // не на каждый визит, вероятностно, отдельного крона не нужно
            // в self-hosted single-container деплое.
            if (Math.random() < 0.01) await pruneOldVisitorHashes();
          })().catch((err) => console.error("landing stats failed", err))
        );
      }
    }
  }

  if (!pathname.startsWith("/api/")) {
    // Язык, пришедший ссылкой с маркетингового сайта rentos365.app. Там
    // TranslatePress с пятью языками, и без этого посетитель с английской
    // версии сайта попадал на регистрацию по-русски (найдено 2026-08-09).
    // Параметр к ссылкам дописывает mu-плагин rentos-app-language-link.php
    // на стороне WordPress; коды языков TranslatePress до "_" совпадают с
    // локалями RentOS, включая украинский uk (слаг в адресе там "ua", но код
    // языка — "uk", поэтому брать надо код, а не слаг).
    const langParam = request.nextUrl.searchParams.get("lang");
    const linkLocale = langParam && isLocale(langParam) ? langParam : null;

    const isPreAuthPage = PRE_AUTH_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );

    if (!isPreAuthPage && !linkLocale) {
      return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
    }

    const headers = new Headers(requestHeaders);
    if (isPreAuthPage) headers.set("x-pre-auth-page", "1");
    // Заголовком, а не только кукой: кука из этого же ответа станет видна
    // лишь со СЛЕДУЮЩЕГО запроса, и первая страница отрендерилась бы на
    // старом языке. resolveLocale() читает заголовок там же, где куку.
    if (linkLocale) headers.set(LINK_LOCALE_HEADER, linkLocale);

    const response = NextResponse.next({ request: { headers } });

    // Кука — чтобы выбранный язык пережил переход на следующие страницы
    // приложения, где параметра в адресе уже не будет.
    if (linkLocale) {
      response.cookies.set(PRE_AUTH_LOCALE_COOKIE, linkLocale, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: PRE_AUTH_LOCALE_MAX_AGE,
      });
    }

    return withCsp(response);
  }

  const isMutating = request.method !== "GET" && request.method !== "HEAD";
  const isExempt = SUBSCRIPTION_GATE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isMutating && !isExempt) {
    const token = request.cookies.get("session")?.value;
    // verifySessionToken, не голый verifyToken — сессия имперсонации
    // (startImpersonation, lib/auth.ts) несёт другой, self-expiring формат
    // токена; голый verifyToken не распознавал бы её вовсе, из-за чего этот
    // гейт подписки молча пропускал бы все мутирующие запросы имперсонации.
    const userId = token ? verifySessionToken(token) : null;
    if (userId) {
      // Одно обращение вместо двух SELECT'ов на КАЖДЫЙ мутирующий запрос
      // (аудит производительности 2026-08-13) — состояние подписки живёт в
      // памяти с коротким TTL и сбрасывается там, где меняется: вебхук
      // FluentCart, действие Super Admin, ночной планировщик. Кэшируется
      // именно биллинговый статус, а не право доступа — вход и права
      // по-прежнему проверяются свежим чтением в requireOwner. Подробности —
      // в lib/subscription-gate.ts.
      const gate = await getSubscriptionGateState(userId);
      if (
        gate?.role === "owner" &&
        gate.subscriptionStatus &&
        SUBSCRIPTION_BLOCKED_STATUSES.has(gate.subscriptionStatus)
      ) {
        return withCsp(
          NextResponse.json(
            { error: "Подписка не активна — доступ только на чтение. Оплатите тариф, чтобы продолжить." },
            { status: 402 }
          )
        );
      }
    }
  }

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
