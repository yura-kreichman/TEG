import ru from "@lang/ru.json";
import en from "@lang/en.json";
import ro from "@lang/ro.json";
import uk from "@lang/uk.json";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getActivatedPoint, getOperatorSessionId } from "@/lib/operator-auth";

// Все строки UI — только из /lang/*.json, в коде — ключи (docs/spec/00-architecture.md).
// ru.json — базовый язык разработки; остальные словари должны иметь тот же
// набор ключей (проверяется только типами TS через тип Dictionary, без
// отдельного скрипта сверки ключей — если один словарь отстанет, tsc это не
// поймает, только ручной аудит).
export type Dictionary = typeof ru;
export type Locale = "ru" | "en" | "ro" | "uk";

const dictionaries: Record<Locale, Dictionary> = { ru, en, ro, uk };

export function isLocale(value: string): value is Locale {
  return value === "ru" || value === "en" || value === "ro" || value === "uk";
}

export function getDictionary(locale: string): Dictionary {
  return isLocale(locale) ? dictionaries[locale] : dictionaries.ru;
}

// Pre-auth language choice (login/register/etc. — no session or tenant to read
// yet). Deliberately lower priority than any real session/tenant locale below,
// so a stale cookie from before signup never overrides an actual tenant
// setting once one exists — see resolveLocale().
const PRE_AUTH_LOCALE_COOKIE = "locale_pref";
const PRE_AUTH_LOCALE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export async function setPreAuthLocaleCookie(locale: string) {
  const cookieStore = await cookies();
  cookieStore.set(PRE_AUTH_LOCALE_COOKIE, isLocale(locale) ? locale : "ru", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PRE_AUTH_LOCALE_MAX_AGE,
  });
}

export async function getPreAuthLocaleCookie(): Promise<Locale | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(PRE_AUTH_LOCALE_COOKIE)?.value;
  return value && isLocale(value) ? value : null;
}

/** Picks the first supported locale from an Accept-Language header, if any. */
export function detectLocaleFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase())
    .map((tag) => tag.split("-")[0]);
  for (const tag of tags) {
    if (isLocale(tag)) return tag;
  }
  return null;
}

/**
 * Резолвит эффективный язык: личное переопределение пользователя/оператора →
 * язык тенанта → пользовательский выбор на экранах входа/регистрации (кука) →
 * язык браузера (Accept-Language) → "ru". Кука и заголовок — только фолбэк
 * для анонимных экранов (вход/регистрация/т.п.), реальная сессия/тенант
 * всегда побеждают, чтобы устаревшая кука не перекрывала настройку тенанта —
 * КРОМЕ самих экранов входа (см. src/proxy.ts, x-pre-auth-page): там человек
 * ещё не "работает как этот аккаунт", и если он уже залогинен где-то ещё в
 * этом же браузере (другая вкладка), его реальный язык не должен перекрывать
 * выбор прямо на экране входа (баг найден 2026-07-10: переключатель на
 * /login выглядел нерабочим именно из-за этого).
 */
export async function resolveLocale(): Promise<Locale> {
  const headerStore = await headers();
  const isPreAuthPage = headerStore.get("x-pre-auth-page") === "1";

  if (!isPreAuthPage) {
    const userId = await getSessionUserId();
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true, tenant: { select: { locale: true } } },
      });
      const locale = user?.locale ?? user?.tenant?.locale;
      if (locale && isLocale(locale)) return locale;
    }

    const operatorId = await getOperatorSessionId();
    if (operatorId) {
      const operator = await prisma.operator.findUnique({
        where: { id: operatorId },
        select: { locale: true, tenant: { select: { locale: true } } },
      });
      const locale = operator?.locale ?? operator?.tenant?.locale;
      if (locale && isLocale(locale)) return locale;
    }

    const point = await getActivatedPoint();
    if (point) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: point.tenantId },
        select: { locale: true },
      });
      if (tenant?.locale && isLocale(tenant.locale)) return tenant.locale;
    }
  }

  const cookieLocale = await getPreAuthLocaleCookie();
  if (cookieLocale) return cookieLocale;

  const detected = detectLocaleFromAcceptLanguage(headerStore.get("accept-language"));
  if (detected) return detected;

  return "ru";
}
