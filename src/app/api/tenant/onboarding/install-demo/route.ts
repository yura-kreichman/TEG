import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { checkPackageLimit } from "@/lib/packages";
import { hashPin } from "@/lib/auth";
import { resolveLocale, getDictionary } from "@/lib/i18n";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

// Иконки — реальные файлы в public/icon-library (см. src/components/icon-picker.tsx,
// формат ключа "семья:имя"), не произвольная строка.
const ICON_ZONE_COUNTERS = "fluent:Car";
const ICON_ASSET_COUNTERS = "fluent:bumper_car";
const ICON_ZONE_STAYS = "material:playground";
const ICON_ASSET_STAYS = "material:playground";
// COLOR_TAG_PALETTE (src/lib/color-tag.ts) — 🟦 и 🟩.
const COLOR_COUNTERS = "#3B82F6";
const COLOR_STAYS = "#22C55E";
// Демо-ПИН не проверяется на занятость — тенант на этом шаге заведомо
// пустой (нет ни одной точки, см. условие показа шторки), значит и
// операторов с этим ПИНом в нём быть не может.
const DEMO_PIN = "1234";

class DemoInstallLimitError extends Error {
  constructor(public response: NextResponse) {
    super("DEMO_INSTALL_LIMIT");
  }
}

/**
 * Установка демо-данных при первом входе Владельца (запрос пользователя
 * 2026-07-27: "туториал с предложением установить демо-данные") — Точка +
 * зона "Счётчики" (актив, 2 тарифа) + зона "Прибывания" (актив, тариф "За
 * вход" с 2 вариантами длительности) + Сотрудник. Названия — на языке
 * владельца (resolveLocale/getDictionary), не жёстко на русском. Никакого
 * маркера "это демо" — с момента создания это обычные редактируемые
 * сущности (решение пользователя: "не надо кнопка удалить демо-данные, их
 * не надо различать").
 */
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const locale = await resolveLocale();
  const t = getDictionary(locale);
  const ob = t.onboarding;
  // Плоские значения вместо owner.tenantId/owner.user.id внутри транзакции
  // ниже — TS не протягивает сужение "owner не null" через вложенную
  // function-декларацию assertLimit (closure), проще вынести один раз.
  const tenantId = owner.tenantId;
  const ownerUserId = owner.user.id;

  try {
    await prisma.$transaction(async (tx) => {
      // Один advisory-лок на весь бандл — тот же паттерн/ключ, что уже
      // используют одиночные POST /api/points, /api/points/[id]/zones,
      // /api/zones/[id]/assets (аудит 2026-07-24, защита от гонки лимитов
      // пакета), здесь просто несколько проверок подряд в одной транзакции.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;

      // Серверная проверка "тенант заведомо пустой" (аудит 2026-07-27) —
      // раньше это было только предположением в комментарии, ничем не
      // подкреплённым в самом коде: маршрут можно было вызвать повторно
      // (два открытых таба с ещё не обновлённым onboardingDismissedAt, или
      // просто прямой запрос) сколько угодно раз, каждый раз создавая ещё
      // один полный демо-бандл. Теперь первый же повторный вызов отклоняется
      // явно, а не полагается только на лимиты пакета (см. assertLimit ниже
      // — те тоже исправлены, но это отдельный, более прямой guard).
      const existingPointCount = await tx.point.count({ where: { tenantId } });
      if (existingPointCount > 0) {
        throw new DemoInstallLimitError(
          NextResponse.json({ error: "Демо-данные уже установлены" }, { status: 409 })
        );
      }

      // currentCount теперь всегда РЕАЛЬНЫЙ счётчик (аудит 2026-07-27, второй
      // раунд, реальная дыра) — раньше сюда передавались захардкоженные
      // литералы (0/1), которые предполагали "тенант заведомо пустой на этом
      // шаге", но ничто в самом роуте это не проверяло: маршрут вызываем
      // сколько угодно раз (нет проверки onboardingDismissedAt/реального
      // отсутствия точек на сервере — только в клиентском рендере шторки),
      // и на КАЖДЫЙ повторный вызов лимит-проверки сравнивались с теми же
      // фиктивными 0/1, вместо настоящего текущего количества — тенант мог
      // бесконечно плодить точки/зоны/активы/операторов сверх пакета одним
      // и тем же запросом.
      async function assertLimit(limitKey: "maxPoints" | "maxZones" | "maxAssets" | "maxOperators") {
        const currentCount = await ({
          maxPoints: () => tx.point.count({ where: { tenantId } }),
          maxZones: () => tx.zone.count({ where: { point: { tenantId } } }),
          maxAssets: () => tx.asset.count({ where: { zone: { point: { tenantId } } } }),
          maxOperators: () => tx.operator.count({ where: { tenantId } }),
        })[limitKey]();
        const limitError = await checkPackageLimit(tenantId, limitKey, currentCount);
        if (limitError) throw new DemoInstallLimitError(limitError);
      }

      // Точка
      await assertLimit("maxPoints");
      const point = await tx.point.create({
        data: {
          tenantId,
          name: ob.demoPointName,
          // Демо-точка сразу готова — в отличие от обычного создания (там
          // default false, "создание = готовлю"), здесь готовить нечего,
          // весь смысл — сразу увидеть рабочий пример.
          active: true,
        },
      });

      // Зона "Счётчики" + актив + 2 тарифа
      await assertLimit("maxZones");
      const zoneCounters = await tx.zone.create({
        data: {
          pointId: point.id,
          sortOrder: 0,
          name: t.zonesList.accountingModeCounters,
          iconKey: ICON_ZONE_COUNTERS,
          accountingMode: "counters",
          active: true,
        },
      });
      await tx.tariff.create({
        data: { zoneId: zoneCounters.id, name: ob.demoTariffStandard, price: 100, order: 1 },
      });
      await tx.tariff.create({
        data: { zoneId: zoneCounters.id, name: ob.demoTariffVip, price: 150, order: 2 },
      });
      await assertLimit("maxAssets");
      await tx.asset.create({
        data: {
          zoneId: zoneCounters.id,
          name: ob.demoAssetCounters,
          iconKey: ICON_ASSET_COUNTERS,
          colorTag: COLOR_COUNTERS,
        },
      });

      // Зона "Прибывания" + тариф "За вход" (2 варианта) + актив
      await assertLimit("maxZones");
      const zoneStays = await tx.zone.create({
        data: {
          pointId: point.id,
          sortOrder: 1,
          name: t.zonesList.accountingModeStays,
          iconKey: ICON_ZONE_STAYS,
          accountingMode: "stays",
          active: true,
        },
      });
      const staysTariff = await tx.tariff.create({
        data: {
          zoneId: zoneStays.id,
          name: t.zoneDetail.gameRoomPricingModeFixed,
          price: 0,
          order: 1,
          pricingMode: "fixed",
        },
      });
      await tx.tariffOption.createMany({
        data: [
          { tariffId: staysTariff.id, name: ob.demoOption30, durationMinutes: 30, price: 100, order: 0 },
          { tariffId: staysTariff.id, name: ob.demoOption60, durationMinutes: 60, price: 180, order: 1 },
        ],
      });
      await assertLimit("maxAssets");
      await tx.asset.create({
        data: {
          zoneId: zoneStays.id,
          name: ob.demoAssetStays,
          iconKey: ICON_ASSET_STAYS,
          colorTag: COLOR_STAYS,
          tariffId: staysTariff.id,
        },
      });

      // Сотрудник — allZonesAccess по умолчанию true (schema default), сразу
      // видит обе демо-зоны без дополнительной настройки доступа.
      await assertLimit("maxOperators");
      const operatorCount = await tx.operator.count({ where: { tenantId } });
      await tx.operator.create({
        data: {
          tenantId,
          name: ob.demoOperatorName,
          pin: DEMO_PIN,
          pinHash: await hashPin(DEMO_PIN),
          createdByUserId: ownerUserId,
          sortOrder: operatorCount,
        },
      });

      await tx.tenant.update({
        where: { id: tenantId },
        data: { onboardingDismissedAt: new Date() },
      });
    });
  } catch (err) {
    if (err instanceof DemoInstallLimitError) return err.response;
    throw err;
  }

  await revalidateLandingForTenant(tenantId);
  return NextResponse.json({ ok: true });
}
