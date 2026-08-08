import { prisma } from "@/lib/prisma";

/**
 * Бесплатный пакет — определяется по fluentcartProductId=null, а не "первый
 * созданный" (то была ошибка: Starter уже не самый старый пакет в реальных
 * данных) и не по priceMonthly=0 (поле убрано целиком 2026-07-29 —
 * дублировало реальный источник истины, FluentCart). У Free
 * fluentcartProductId намеренно не привязан — этот пакет никогда не
 * покупается, тем самым null уже однозначно значит "бесплатный". Фолбэк на
 * создание — только для свежей инсталляции, где пакетов нет вовсе.
 *
 * Живёт отдельным файлом, потому что нужен двум путям создания тенанта:
 * саморегистрации (api/auth/register) и созданию по факту покупки
 * (lib/fluentcart-provision.ts).
 */
export async function getDefaultPackage() {
  const existing = await prisma.package.findFirst({ where: { fluentcartProductId: null } });
  if (existing) return existing;

  return prisma.package.create({
    data: {
      name: "Free",
      maxPoints: 1,
      maxZones: 2,
      maxAssets: 10,
      maxOperators: 3,
    },
  });
}
