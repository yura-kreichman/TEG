import ru from "@lang/ru.json";
import en from "@lang/en.json";
import uk from "@lang/uk.json";
import ro from "@lang/ro.json";
import be from "@lang/be.json";
import pl from "@lang/pl.json";
import it from "@lang/it.json";
import uz from "@lang/uz.json";
import kk from "@lang/kk.json";
import tg from "@lang/tg.json";
import ky from "@lang/ky.json";
import hy from "@lang/hy.json";
import az from "@lang/az.json";
import ka from "@lang/ka.json";
import tr from "@lang/tr.json";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getActivatedPoint, getOperatorSessionId } from "@/lib/operator-auth";
import {
  type Locale,
  isLocale,
  PRE_AUTH_LOCALE_COOKIE,
  PRE_AUTH_LOCALE_MAX_AGE,
  LINK_LOCALE_HEADER,
} from "@/lib/locales";

export type { Locale };
export { isLocale, LOCALE_NAMES, ALL_LOCALES } from "@/lib/locales";

// Все строки UI — только из /lang/*.json, в коде — ключи (docs/spec/00-architecture.md).
// ru.json — базовый язык разработки; остальные словари должны иметь тот же
// набор ключей (проверяется только типами TS через тип Dictionary, без
// отдельного скрипта сверки ключей — если один словарь отстанет, tsc это не
// поймает, только ручной аудит).
export type Dictionary = typeof ru;

// Раздел admin (модуль Super Admin, /admin/*) намеренно ВСЕГДА берётся из
// ru.json, каким бы ни был локаль пользователя — решение пользователя
// 2026-07-29: "У Админа только один язык — русский". Это внутренний
// инструмент оператора платформы, а не интерфейс тенанта, переводить его на
// 15 языков смысла нет.
//
// До этого правило существовало только на словах, и выполнить его было
// физически невозможно: Dictionary = typeof ru, поэтому ЛЮБОЙ новый admin-ключ
// обязан был появиться во всех 15 файлах, иначе не компилировалось (упёрлись
// 2026-08-02 при добавлении раздела "потерянные регистрации"). Подмена здесь
// снимает это раз и навсегда: новые admin-строки заводятся только в ru.json,
// остальные словари их не касаются вовсе. Уже переведённые admin-ключи в
// прочих языках остаются в файлах как безобидное наследство — они просто
// больше не используются.
const withRuAdmin = <T extends Omit<Dictionary, "admin">>(dict: T): Dictionary =>
  ({ ...dict, admin: ru.admin }) as Dictionary;

const dictionaries: Record<Locale, Dictionary> = {
  ru,
  en: withRuAdmin(en),
  uk: withRuAdmin(uk),
  ro: withRuAdmin(ro),
  be: withRuAdmin(be),
  pl: withRuAdmin(pl),
  it: withRuAdmin(it),
  uz: withRuAdmin(uz),
  kk: withRuAdmin(kk),
  tg: withRuAdmin(tg),
  ky: withRuAdmin(ky),
  hy: withRuAdmin(hy),
  az: withRuAdmin(az),
  ka: withRuAdmin(ka),
  tr: withRuAdmin(tr),
};

export function getDictionary(locale: string): Dictionary {
  return isLocale(locale) ? dictionaries[locale] : dictionaries.ru;
}

// Pre-auth language choice (login/register/etc. — no session or tenant to read
// yet). Deliberately lower priority than any real session/tenant locale below,
// so a stale cookie from before signup never overrides an actual tenant
// setting once one exists — see resolveLocale().
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

/**
 * Стирание куки после входа сотрудника (правка владельца 2026-08-19).
 * Устройство точки общее: выбор языка на экране входа — это выбор одного
 * человека на один вход, а не настройка планшета на год. Пока кука жила,
 * она переучивала на свой язык каждого следующего вошедшего.
 */
export async function clearPreAuthLocaleCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(PRE_AUTH_LOCALE_COOKIE);
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
        select: { role: true, locale: true, tenant: { select: { locale: true } } },
      });
      // "/" сам не входит в PRE_AUTH_PATHS (может показать и настоящий
      // дашборд), но для super_admin (или иной не-"owner" роли) он рендерит
      // WelcomeCard — тот же анонимный экран, что /login. Без этой проверки
      // их сессия молча перекрывала бы свежий выбор языка на переключателе
      // welcome-экрана, тот же баг, что чинили для /login 2026-07-10 (см.
      // комментарий выше), просто здесь роль решает, а не путь.
      const locale = user?.locale ?? user?.tenant?.locale;
      if (user?.role === "owner" && locale && isLocale(locale)) return locale;
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

  // Язык, пришедший ссылкой с маркетингового сайта rentos365.app (?lang=xx,
  // proxy.ts кладёт его в заголовок). Приоритет — как у куки: ниже реальной
  // сессии/тенанта, но выше языка браузера. То есть владелец с русским
  // кабинетом, кликнувший ссылку с английской версии сайта, останется на
  // русском, а незалогиненный посетитель получит английскую регистрацию.
  const linkLocale = headerStore.get(LINK_LOCALE_HEADER);
  if (linkLocale && isLocale(linkLocale)) return linkLocale;

  const cookieLocale = await getPreAuthLocaleCookie();
  if (cookieLocale) return cookieLocale;

  // Экран входа на устройстве, привязанном к точке (правка владельца
  // 2026-08-19): язык компании, а не язык браузера планшета. Ниже куки —
  // явный выбор в переключателе на самом экране должен побеждать, иначе
  // переключатель выглядит нерабочим (тот же баг, что чинили 2026-07-10).
  if (isPreAuthPage) {
    const devicePoint = await getActivatedPoint();
    if (devicePoint) {
      const deviceTenant = await prisma.tenant.findUnique({
        where: { id: devicePoint.tenantId },
        select: { locale: true },
      });
      if (deviceTenant?.locale && isLocale(deviceTenant.locale)) return deviceTenant.locale;
    }
  }

  const detected = detectLocaleFromAcceptLanguage(headerStore.get("accept-language"));
  if (detected) return detected;

  return "ru";
}
