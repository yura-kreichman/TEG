import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { verifyToken } from "@/lib/session-crypto";
import { prisma } from "@/lib/prisma";
import { resolveTenantBySlug } from "@/lib/landing/resolve-tenant";
import { isBotUserAgent, recordLandingVisit, pruneOldVisitorHashes } from "@/lib/landing/stats";
import { isRateLimited } from "@/lib/landing/rate-limit";
import { getClientIp } from "@/lib/instructions/request-ip";

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

// /site/{slug} (Лендинг) и /i/{slug}/{instructionSlug} (Инструктажи) вместе:
// docs/spec/08-landing.md — с 2026-07-13 Tenant.slug общий и редактируемый,
// поэтому 301 на актуальный слаг при попадании в TenantOldSlug нужен обоим
// путям (см. src/lib/landing/resolve-tenant.ts). Сбор статистики/rate limit
// — только для /site/, GET, не превью, не боты.
const SITE_PATH_RE = /^\/site\/([^/]+)\/?$/;
const INSTRUCTION_PATH_RE = /^\/i\/([^/]+)\/([^/]+)\/?$/;

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  const siteMatch = SITE_PATH_RE.exec(pathname);
  const instructionMatch = INSTRUCTION_PATH_RE.exec(pathname);
  if (siteMatch || instructionMatch) {
    const slug = (siteMatch ?? instructionMatch)![1]!;
    const resolved = await resolveTenantBySlug(slug);

    if (resolved.kind === "redirect") {
      const url = request.nextUrl.clone();
      url.pathname = siteMatch ? `/site/${resolved.currentSlug}` : `/i/${resolved.currentSlug}/${instructionMatch![2]}`;
      return NextResponse.redirect(url, 301);
    }

    if (siteMatch && resolved.kind === "found" && request.method === "GET") {
      const ip = getClientIp(request);
      if (isRateLimited(ip)) {
        return new NextResponse("Too Many Requests", { status: 429 });
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
    const isPreAuthPage = PRE_AUTH_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
    if (!isPreAuthPage) return NextResponse.next();

    const headers = new Headers(request.headers);
    headers.set("x-pre-auth-page", "1");
    return NextResponse.next({ request: { headers } });
  }

  const isMutating = request.method !== "GET" && request.method !== "HEAD";
  const isExempt = SUBSCRIPTION_GATE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isMutating && !isExempt) {
    const token = request.cookies.get("session")?.value;
    const userId = token ? verifyToken(token) : null;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, tenantId: true } });
      if (user?.role === "owner" && user.tenantId) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: user.tenantId },
          select: { subscriptionStatus: true },
        });
        if (tenant && SUBSCRIPTION_BLOCKED_STATUSES.has(tenant.subscriptionStatus)) {
          return NextResponse.json(
            { error: "Подписка не активна — доступ только на чтение. Оплатите тариф, чтобы продолжить." },
            { status: 402 }
          );
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
