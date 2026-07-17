import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getTenantLimits } from "@/lib/packages";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    include: { package: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Тенант не найден" }, { status: 404 });
  }

  const limits = await getTenantLimits(owner.tenantId);

  const [pointsUsed, operatorsUsed, zonesUsed, assetsUsed] = await Promise.all([
    prisma.point.count({ where: { tenantId: owner.tenantId } }),
    prisma.operator.count({ where: { tenantId: owner.tenantId } }),
    prisma.zone.count({ where: { point: { tenantId: owner.tenantId } } }),
    prisma.asset.count({ where: { zone: { point: { tenantId: owner.tenantId } } } }),
  ]);

  return NextResponse.json({
    packageName: tenant.package.name,
    subscriptionStatus: tenant.subscriptionStatus,
    subscriptionExpiresAt: tenant.subscriptionExpiresAt,
    // Информационное, из вебхука FluentCart — см. Tenant.currentPeriodEnd в
    // schema.prisma и docs/fluentcart-webhook-schema.md §3.
    currentPeriodEnd: tenant.currentPeriodEnd,
    // Ручной оверрайд Super Admin'а (запрос пользователя 2026-07-17) —
    // отдельным флагом, не через числовой max: Infinity не переживает
    // JSON.stringify (стал бы null), max ниже в этом случае лишь запасное
    // значение на случай старого клиента, реальный источник — этот флаг.
    unlimited: tenant.unlimited,
    // packageMax — значение пакета без оверрайда, чтобы владелец видел не
    // только эффективный лимит (max), но и что часть сверх пакета выдал
    // Super Admin вручную (docs/spec/06-super-admin.md, п.6) — та же дельта,
    // что видна админу на /admin/tenants/[id].
    points: {
      used: pointsUsed,
      max: tenant.unlimited ? pointsUsed : (limits?.maxPoints ?? tenant.package.maxPoints),
      packageMax: tenant.package.maxPoints,
    },
    operators: {
      used: operatorsUsed,
      max: tenant.unlimited ? operatorsUsed : (limits?.maxOperators ?? tenant.package.maxOperators),
      packageMax: tenant.package.maxOperators,
    },
    zones: {
      used: zonesUsed,
      max: tenant.unlimited ? zonesUsed : (limits?.maxZones ?? tenant.package.maxZones),
      packageMax: tenant.package.maxZones,
    },
    assets: {
      used: assetsUsed,
      max: tenant.unlimited ? assetsUsed : (limits?.maxAssets ?? tenant.package.maxAssets),
      packageMax: tenant.package.maxAssets,
    },
  });
}
