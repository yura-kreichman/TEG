import { prisma } from "@/lib/prisma";
import { getBusinessDayBounds } from "@/lib/business-day";
import { isOpenNow, findNextOpen, type DayHours } from "@/lib/landing/opening-hours";

export type TodayStatus =
  | { kind: "working"; zoneNames: string[] }
  | { kind: "closed"; nextOpenWeekday: number; nextOpenTime: string; daysAhead: number }
  | { kind: "none" }; // недостаточно данных — строка не рендерится (докс)

/**
 * "Сегодня работают" (docs/spec/08-landing.md, "Живые секции и фишки") —
 * зона считается активной сегодня, если по ней уже была сдача итогов в
 * рамках ТЕКУЩЕГО бизнес-дня тенанта (не календарного, тот же принцип, что у
 * "Кассы за день" — businessDayBoundary/Tenant.timezone), ИЛИ если точка
 * этой зоны прямо сейчас в часах работы. Никогда не объясняет ПОЧЕМУ
 * закрыто (докс: "никогда не показывать причин закрытия") — только "Завтра
 * с {время}" / ближайший рабочий день, без слов "закрыто"/"выходной"/etc.
 */
export async function getTodayWorkingStatus(tenantId: string): Promise<TodayStatus> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  if (!tenant) return { kind: "none" };

  // Деактивированные (сезонно закрытые) точки/зоны исключены целиком —
  // тот же принцип, что в get-render-data.ts.
  const points = await prisma.point.findMany({
    where: { tenantId, active: true },
    select: {
      id: true,
      openingHours: { select: { weekday: true, isOpen: true, opensAt: true, closesAt: true } },
      zones: { where: { active: true }, select: { id: true, name: true } },
    },
  });
  if (points.length === 0) return { kind: "none" };

  const now = new Date();
  const { start } = getBusinessDayBounds(tenant.businessDayBoundary, now, tenant.timezone);
  const allZoneIds = points.flatMap((p) => p.zones.map((z) => z.id));

  const submittedZoneIds = new Set(
    allZoneIds.length === 0
      ? []
      : (
          await prisma.zoneSubmission.findMany({
            where: { zoneId: { in: allZoneIds }, createdAt: { gte: start } },
            select: { zoneId: true },
            distinct: ["zoneId"],
          })
        ).map((s) => s.zoneId)
  );

  const workingZoneNames: string[] = [];
  let anyHoursConfigured = false;
  // Витрина одна на тенанта — если сейчас закрыто везде, показываем ОДНО
  // ближайшее открытие среди всех точек (минимум по daysAhead, затем по
  // времени открытия в этот день), а не расписание точку за точкой.
  let bestNextOpen: { weekday: number; time: string; isTomorrow: boolean; daysAhead: number } | null = null;

  for (const point of points) {
    const hours: DayHours[] = point.openingHours;
    if (hours.length === 7) anyHoursConfigured = true;
    const openNow = isOpenNow(hours, tenant.timezone, now);

    for (const zone of point.zones) {
      if (submittedZoneIds.has(zone.id) || openNow === true) {
        workingZoneNames.push(zone.name);
      }
    }

    if (openNow === false && hours.length === 7) {
      const next = findNextOpen(hours, tenant.timezone, now);
      if (
        next &&
        (!bestNextOpen ||
          next.daysAhead < bestNextOpen.daysAhead ||
          (next.daysAhead === bestNextOpen.daysAhead && next.time < bestNextOpen.time))
      ) {
        bestNextOpen = next;
      }
    }
  }

  if (workingZoneNames.length > 0) {
    return { kind: "working", zoneNames: [...new Set(workingZoneNames)] };
  }
  if (!anyHoursConfigured) return { kind: "none" };
  if (bestNextOpen) {
    return { kind: "closed", nextOpenWeekday: bestNextOpen.weekday, nextOpenTime: bestNextOpen.time, daysAhead: bestNextOpen.daysAhead };
  }
  return { kind: "none" };
}
