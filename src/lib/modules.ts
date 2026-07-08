import { prisma } from "@/lib/prisma";

// Включение модулей на уровне тенанта — feature flags (docs/spec/00-architecture.md).
// Источник: набор модулей пакета подписки (Package.modules), поверх которого
// TenantModule может явно включить/выключить конкретный модуль для тенанта
// (индивидуальные условия) — оверрайд побеждает, если он есть.
export async function isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
  const override = await prisma.tenantModule.findUnique({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
  });
  if (override) return override.enabled;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { package: true } });
  return tenant?.package.modules.includes(moduleKey) ?? false;
}
