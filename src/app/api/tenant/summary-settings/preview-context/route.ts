import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import type { ZoneAccountingMode } from "@/lib/results-calc";

const PREVIEW_MODES: ZoneAccountingMode[] = ["counters", "launches", "stays", "cash_only", "tickets"];

// Реальные названия (зона/точка/активы/тарифы/оператор) для живого
// предпросмотра сводок в редакторах (/settings/summaries/*) — цифры там
// остаются демо-числами (что именно показывать/скрывать проверяется
// тумблерами, не суммами), но названия должны быть настоящими, иначе
// предпросмотр не отражает то, что реально уйдёт в чат. Если у тенанта ещё
// нет точки/зоны/оператора — соответствующее поле возвращается null, и
// экран сам подставляет плейсхолдер "не создан(а)".
//
// Верхнеуровневые поля (pointName/zoneName/...) — старая плоская форма,
// самая старая зона тенанта ЛЮБОГО режима: её по-прежнему используют
// daily-cash/shift-close (сводки не по зоне, режим учёта им не важен) — не
// трогаем, чтобы не ломать.
//
// byMode — отдельный реальный контекст на каждый режим учёта, только для
// карусели предпросмотра "Сводки по зоне" (реальный баг, найден
// пользователем 2026-07-19: карусель показывает несколько режимов свайпом,
// но раньше этот же API отдавал только ОДНУ зону — самую старую по всему
// тенанту, любого режима — поэтому вкладки остальных режимов показывали
// "Зона не создана", даже когда у тенанта реально была зона этого режима,
// просто не самая старая). Оператор — тоже per-mode, не общий на тенанта:
// у операторов может быть выборочный доступ к зонам (allZonesAccess=false +
// allowedZones), реальный баг, найден пользователем 2026-07-19 — предпросмотр
// показывал оператора без доступа к этой конкретной зоне ("Женя" вместо
// "Кати", у которой реально назначена эта зона).
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const tenantId = owner.tenantId;

  const [allZones, pointCount, tenant, fallbackOperator] = await Promise.all([
    prisma.zone.findMany({
      where: { point: { tenantId: owner.tenantId } },
      orderBy: { createdAt: "asc" },
      include: {
        point: true,
        tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" } },
        assets: { orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.point.count({ where: { tenantId: owner.tenantId } }),
    prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } }),
    prisma.operator.findFirst({ where: { tenantId: owner.tenantId }, orderBy: { sortOrder: "asc" } }),
  ]);

  const zone = allZones[0];
  const fallbackPoint =
    zone?.point ?? (await prisma.point.findFirst({ where: { tenantId: owner.tenantId }, orderBy: { createdAt: "asc" } }));

  // Оператор с реальным доступом к этой зоне — allZonesAccess=true (доступ ко
  // всему) или зона явно в allowedZones. Без доступа к зонам показывать
  // оператора не имеет смысла (та же логика, что requireOperator использует
  // при входе) — тогда просто null, как и при отсутствии зоны.
  async function operatorForZone(zoneId: string) {
    return prisma.operator.findFirst({
      where: {
        tenantId,
        active: true,
        OR: [{ allZonesAccess: true }, { allowedZones: { some: { id: zoneId } } }],
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  async function contextForZone(z: (typeof allZones)[number] | undefined) {
    if (!z) {
      return {
        pointName: fallbackPoint?.name ?? null,
        zoneName: null,
        zoneEmoji: null,
        accountingMode: null as string | null,
        readingPairs: [] as { assetName: string; tariffName: string }[],
        assetNames: [] as string[],
        zoneNames: [] as string[],
        operatorName: null as string | null,
        operatorColorTag: null as string | null,
      };
    }
    // Группировка по активу (сначала все тарифы одного актива, потом
    // следующий актив) — так же, как реально строит readingLines в
    // submit-results/route.ts, иначе предпросмотр показывал бы другой
    // порядок строк, чем настоящее сообщение.
    const readingPairs = z.assets
      .flatMap((asset) => z.tariffs.map((tariff) => ({ assetName: asset.name, tariffName: tariff.name })))
      .slice(0, 4);
    const assetNames = z.assets.map((asset) => asset.name).slice(0, 4);
    const zoneNames = allZones
      .filter((sibling) => sibling.pointId === z.pointId)
      .slice(0, 4)
      .map((sibling) => sibling.name);
    const zoneOperator = await operatorForZone(z.id);
    return {
      pointName: z.point.name,
      zoneName: z.name,
      zoneEmoji: z.telegramEmoji,
      accountingMode: z.accountingMode as string,
      readingPairs,
      assetNames,
      zoneNames,
      operatorName: zoneOperator?.name ?? null,
      operatorColorTag: zoneOperator?.colorTag ?? null,
    };
  }

  const flat = await contextForZone(zone);
  const byMode = Object.fromEntries(
    await Promise.all(
      PREVIEW_MODES.map(async (mode) => [mode, await contextForZone(allZones.find((z) => z.accountingMode === mode))])
    )
  ) as Record<ZoneAccountingMode, Awaited<ReturnType<typeof contextForZone>>>;

  return NextResponse.json({
    ...flat,
    pointCount,
    timezone: tenant?.timezone ?? "UTC",
    // Верхнеуровневые operatorName/operatorColorTag — общий fallback для
    // daily-cash/shift-close (не зоно-специфичные сводки, зона тут ни при
    // чём), оставлен как было — намеренно не совпадает с byMode-логикой выше.
    operatorName: fallbackOperator?.name ?? null,
    operatorColorTag: fallbackOperator?.colorTag ?? null,
    byMode,
  });
}
