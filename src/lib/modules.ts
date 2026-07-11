import { prisma } from "@/lib/prisma";
import { MODULE_KEYS } from "@/lib/module-keys";

// MODULE_KEYS/ModuleKey live in module-keys.ts (client-safe, no prisma import)
// — re-exported here so existing server-side `from "@/lib/modules"` imports
// keep working unchanged.
export { MODULE_KEYS, type ModuleKey } from "@/lib/module-keys";

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

// Батч-версия isModuleEnabled для всех MODULE_KEYS разом (нижний бар кабинета
// владельца — docs/spec/00-architecture.md, "Навигация") — один запрос на
// оверрайды + один на пакет, а не N отдельных isModuleEnabled(...) на каждый
// пункт бара.
export async function getEnabledModules(tenantId: string): Promise<Record<string, boolean>> {
  const [overrides, tenant] = await Promise.all([
    prisma.tenantModule.findMany({ where: { tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, include: { package: true } }),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.moduleKey, o.enabled]));
  const packageModules = new Set(tenant?.package.modules ?? []);

  const result: Record<string, boolean> = {};
  for (const key of MODULE_KEYS) {
    result[key] = overrideByKey.get(key) ?? packageModules.has(key);
  }
  return result;
}
