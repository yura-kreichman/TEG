import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPackageLimit } from "@/lib/packages";
import { requireOwner } from "@/lib/require-owner";
import { isZoneAccountingMode } from "@/lib/results-calc";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

export async function GET(_request: Request, ctx: RouteContext<"/api/points/[id]/zones">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const [zones, tenantOperators] = await Promise.all([
    prisma.zone.findMany({
      where: { pointId },
      include: {
        tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" } },
        assets: { orderBy: { sortOrder: "asc" } },
        // Сотрудники с ВЫБОРОЧНЫМ доступом, включающим эту зону (запрос
        // пользователя 2026-07-28: "вместо тарифов — какой сотрудник
        // привязан к этой зоне"). Операторы с allZonesAccess=true сюда не
        // попадают (эта связь пуста для них) — их добавляем отдельно ниже.
        operatorsWithAccess: { where: { active: true }, select: { id: true, name: true, colorTag: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    // Операторы "со всеми зонами" — реальный баг, найден пользователем
    // 2026-07-28: "у Жени все зоны и он не отображается" — они тоже
    // фактически привязаны к каждой зоне точки, просто не через
    // operatorsWithAccess (та связь только для ВЫБОРОЧНОГО доступа).
    prisma.operator.findMany({
      where: { tenantId: owner.tenantId, active: true, allZonesAccess: true },
      select: { id: true, name: true, colorTag: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const zonesWithOperators = zones.map((zone) => {
    // dedupe — на случай, если оператор с allZonesAccess=true всё ещё
    // числится и в выборочном списке (устаревшие данные), не должен
    // показаться дважды.
    const byId = new Map([...tenantOperators, ...zone.operatorsWithAccess].map((op) => [op.id, op]));
    return { ...zone, operatorsWithAccess: [...byId.values()] };
  });

  return NextResponse.json({ zones: zonesWithOperators, pointName: point.name, pointActive: point.active });
}

export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/zones">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { name, iconKey, accountingMode } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название зоны обязательно" }, { status: 400 });
  }
  if (accountingMode !== undefined && !isZoneAccountingMode(accountingMode)) {
    return NextResponse.json({ error: "Некорректный режим учёта" }, { status: 400 });
  }

  // Счёт+проверка+создание под локом (аудит 2026-07-24) — maxZones считается
  // по всему тенанту, лимит той же природы, что и у Точек, лочимся по
  // tenantId, тот же паттерн, что /api/points POST.
  const resolvedAccountingMode = isZoneAccountingMode(accountingMode) ? accountingMode : "counters";
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.tenantId}))`;
    const zoneCount = await tx.zone.count({ where: { point: { tenantId: owner.tenantId } } });
    const limitError = await checkPackageLimit(owner.tenantId, "maxZones", zoneCount);
    if (limitError) return { ok: false as const, limitError };

    // В конец списка точки (порядок задаёт владелец кнопками вверх/вниз,
    // /api/zones/[id]/move) — новая зона не должна вклиниваться в середину.
    const lastZone = await tx.zone.findFirst({
      where: { pointId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const zone = await tx.zone.create({
      data: {
        pointId,
        sortOrder: (lastZone?.sortOrder ?? -1) + 1,
        name: name.trim(),
        iconKey: typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null,
        accountingMode: resolvedAccountingMode,
        // Новая зона по умолчанию неактивна (запрос пользователя 2026-07-24:
        // "создание = готовлю, включение = готово") — Владелец сначала
        // настраивает тарифы/активы, затем сам включает, когда готова; это
        // же включение — единственный триггер автоанонса в публичную группу
        // (см. active в zones/[id]/route.ts PATCH), не само создание.
        active: false,
      },
    });
    return { ok: true as const, zone };
  });
  if (!result.ok) return result.limitError;
  const zone = result.zone;

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ id: zone.id, name: zone.name }, { status: 201 });
}
