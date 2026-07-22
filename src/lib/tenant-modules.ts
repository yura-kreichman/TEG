import { prisma } from "@/lib/prisma";

// Настройки → Система → "Модули" (запрос пользователя 2026-07-22) — общий
// helper для серверной проверки во всех API-роутах затронутых модулей.
// Прячется не только nav-пункт (owner-shell.tsx) — без серверной проверки
// прямой запрос в обход интерфейса всё равно сработал бы (тот же принцип,
// что уже применён к Operator.goodsAccess/Tenant.goodsAllowBalancePayment).
export interface TenantModuleFlags {
  instructionsEnabled: boolean;
  tasksEnabled: boolean;
  landingEnabled: boolean;
  goodsEnabled: boolean;
  clientsEnabled: boolean;
}

export type ModuleFlagKey = keyof TenantModuleFlags;

export async function getTenantModuleFlags(tenantId: string): Promise<TenantModuleFlags> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      instructionsEnabled: true,
      tasksEnabled: true,
      landingEnabled: true,
      goodsEnabled: true,
      clientsEnabled: true,
    },
  });
  return {
    instructionsEnabled: tenant?.instructionsEnabled ?? true,
    tasksEnabled: tenant?.tasksEnabled ?? true,
    landingEnabled: tenant?.landingEnabled ?? true,
    goodsEnabled: tenant?.goodsEnabled ?? true,
    clientsEnabled: tenant?.clientsEnabled ?? true,
  };
}

// Точечная проверка одного модуля — самый частый случай в роутах (не нужны
// остальные 5 полей).
export async function isModuleEnabled(tenantId: string, module: ModuleFlagKey): Promise<boolean> {
  const flags = await getTenantModuleFlags(tenantId);
  return flags[module];
}
