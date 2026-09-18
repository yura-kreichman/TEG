import { prisma } from "@/lib/prisma";

// Карточка «Первые шаги» (docs/spec/13-onboarding.md). Шаги считаются по
// реальным данным тенанта — отмечать вручную нечего. Та же функция считает
// колонку «Настройка» в Super Admin, чтобы админка и владелец не расходились.

export type SetupStepKey = "point" | "zone" | "zoneOn" | "operator" | "device" | "firstWork";

// Подсказка к невыполненному шагу: ключ строки в словаре onboarding.hints и
// имена из данных владельца, которые в неё подставляются.
export type SetupHintKey =
  | "addPoint"
  | "activatePoint"
  | "addZone"
  | "addTariff"
  | "addAsset"
  | "activateAsset"
  | "addTicketPrice"
  | "activateZone"
  | "zoneOnLater"
  | "addOperator"
  | "addDevice"
  | "firstWork";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  // Экран, где шаг делается; null — шаг делается не в кабинете (первая
  // работа идёт на планшете точки).
  href: string | null;
  hint: { key: SetupHintKey; params: Record<string, string> } | null;
}

export interface SetupProgress {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  landingPublished: boolean;
}

type ZoneForSetup = {
  id: string;
  name: string;
  active: boolean;
  accountingMode: string;
  _count: { tariffs: number };
  assets: { name: string; active: boolean; _count: { ticketVariants: number } }[];
};

/**
 * Готова ли зона к работе сотрудника — зависит от режима учёта. «Только
 * касса» не требует ничего, «Билеты» — включённый актив с ценой билета,
 * остальные — тариф и включённый актив.
 */
function zoneReady(zone: ZoneForSetup): boolean {
  if (zone.accountingMode === "cash_only") return true;
  if (zone.accountingMode === "tickets") return zone.assets.some((a) => a.active && a._count.ticketVariants > 0);
  return zone._count.tariffs > 0 && zone.assets.some((a) => a.active);
}

// Что именно не хватает зоне — первая недостающая вещь, по порядку, в котором
// владелец её и настраивает.
function zoneHint(zone: ZoneForSetup): SetupStep["hint"] {
  const params = { zone: zone.name };
  const needsTariff = zone.accountingMode !== "tickets";
  if (needsTariff && zone._count.tariffs === 0) return { key: "addTariff", params };
  if (zone.assets.length === 0) return { key: "addAsset", params };
  const firstInactive = zone.assets.find((a) => !a.active);
  if (!zone.assets.some((a) => a.active) && firstInactive) {
    return { key: "activateAsset", params: { ...params, asset: firstInactive.name } };
  }
  return { key: "addTicketPrice", params };
}

export async function computeSetupProgress(tenantId: string): Promise<SetupProgress> {
  const [points, activeOperators, activatedDevices, submission, launch, ticketOrder, landing] = await Promise.all([
    prisma.point.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        active: true,
        zones: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            active: true,
            accountingMode: true,
            _count: { select: { tariffs: { where: { deletedAt: null } } } },
            assets: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: {
                name: true,
                active: true,
                _count: { select: { ticketVariants: { where: { deletedAt: null } } } },
              },
            },
          },
        },
      },
    }),
    prisma.operator.count({ where: { tenantId, active: true } }),
    prisma.pointDevice.count({ where: { activated: true, point: { tenantId } } }),
    prisma.resultsSubmission.findFirst({ where: { tenantId }, select: { id: true } }),
    prisma.launch.findFirst({ where: { zone: { point: { tenantId } } }, select: { id: true } }),
    prisma.ticketOrder.findFirst({ where: { zone: { point: { tenantId } } }, select: { id: true } }),
    prisma.landing.findUnique({ where: { tenantId }, select: { status: true } }),
  ]);

  const activePoints = points.filter((p) => p.active);
  // Пока ни одна точка не включена, подсказки по зонам всё равно полезны —
  // берём зоны всех точек; засчитываются же шаги только на включённых.
  const guidePoints = activePoints.length > 0 ? activePoints : points;
  const guideZones = guidePoints.flatMap((p) => p.zones);
  const liveZones = activePoints.flatMap((p) => p.zones);

  const steps: SetupStep[] = [];

  steps.push({
    key: "point",
    done: activePoints.length > 0,
    href: "/points",
    hint:
      points.length === 0
        ? { key: "addPoint", params: {} }
        : { key: "activatePoint", params: { point: points[0]!.name } },
  });

  const readyZone = liveZones.find(zoneReady);
  const firstGuidePoint = guidePoints[0];
  const unreadyZone = guideZones.find((z) => !zoneReady(z));
  steps.push({
    key: "zone",
    done: Boolean(readyZone),
    href: guideZones.length === 0 ? (firstGuidePoint ? `/points/${firstGuidePoint.id}` : "/points") : `/zones/${(unreadyZone ?? guideZones[0]!).id}`,
    // Без точки подсказки нет: «Добавьте точку» уже сказано шагом выше.
    hint:
      guideZones.length === 0
        ? firstGuidePoint
          ? { key: "addZone", params: { point: firstGuidePoint.name } }
          : null
        : unreadyZone
          ? zoneHint(unreadyZone)
          : // Зона настроена, но стоит на выключенной точке.
            { key: "activatePoint", params: { point: firstGuidePoint!.name } },
  });

  // Включить имеет смысл уже настроенную зону — её и называем.
  const readyInactiveZone = guideZones.find((z) => zoneReady(z) && !z.active);
  steps.push({
    key: "zoneOn",
    done: liveZones.some((z) => z.active && zoneReady(z)),
    href: readyInactiveZone ? `/zones/${readyInactiveZone.id}` : null,
    hint: readyInactiveZone
      ? { key: "activateZone", params: { zone: readyInactiveZone.name } }
      : { key: "zoneOnLater", params: {} },
  });

  steps.push({
    key: "operator",
    done: activeOperators > 0,
    href: "/operators",
    hint: { key: "addOperator", params: {} },
  });

  steps.push({
    key: "device",
    done: activatedDevices > 0,
    href: "/points",
    hint: { key: "addDevice", params: {} },
  });

  steps.push({
    key: "firstWork",
    done: Boolean(submission || launch || ticketOrder),
    href: null,
    hint: { key: "firstWork", params: {} },
  });

  // Пройденному шагу подсказка не нужна.
  for (const step of steps) if (step.done) step.hint = null;

  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    landingPublished: landing?.status === "published",
  };
}
