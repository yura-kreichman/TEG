import ru from "@lang/ru.json";
import en from "@lang/en.json";
import ro from "@lang/ro.json";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getActivatedPoint } from "@/lib/operator-auth";

// Все строки UI — только из /lang/*.json, в коде — ключи (docs/spec/00-architecture.md).
// ru.json — базовый язык разработки; остальные словари должны иметь тот же
// набор ключей (проверяется только типами TS через тип Dictionary, без
// отдельного скрипта сверки ключей — если один словарь отстанет, tsc это не
// поймает, только ручной аудит).
export type Dictionary = typeof ru;
export type Locale = "ru" | "en" | "ro";

const dictionaries: Record<Locale, Dictionary> = { ru, en, ro };

export function isLocale(value: string): value is Locale {
  return value === "ru" || value === "en" || value === "ro";
}

export function getDictionary(locale: string): Dictionary {
  return isLocale(locale) ? dictionaries[locale] : dictionaries.ru;
}

/**
 * Резолвит эффективный язык: личное переопределение пользователя → язык
 * тенанта → "ru". Работает и для Owner (сессия), и для Operator (устройство
 * точки), в остальных случаях (страницы входа/регистрации, где ещё нет ни
 * сессии, ни привязанного устройства) — язык тенанта не известен, "ru".
 */
export async function resolveLocale(): Promise<Locale> {
  const userId = await getSessionUserId();
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true, tenant: { select: { locale: true } } },
    });
    const locale = user?.locale ?? user?.tenant?.locale;
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

  return "ru";
}
