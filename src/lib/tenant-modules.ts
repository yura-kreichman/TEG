import { prisma } from "@/lib/prisma";
import { cached, invalidateCached } from "@/lib/short-cache";

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

// Кэш на 30 секунд со сбросом на записи (аудит производительности
// 2026-08-13). Эти пять булевых полей читались отдельным SELECT'ом на КАЖДЫЙ
// вызов isModuleEnabled, а он зовётся из 71 файла роутов — отсюда 306 тыс.
// обращений к Tenant на проде при пяти тенантах. Меняются они кнопкой в
// Настройках раз в месяц, и та кнопка сбрасывает кэш сама
// (invalidateTenantModuleFlags в api/tenant/system-settings), так что
// задержки применения нет; TTL — страховка на случай правки мимо приложения.
//
// Это НАСТРОЙКА, а не право доступа: кэшировать личность и отзыв сессий
// нельзя, см. предупреждение в lib/short-cache.ts.
const MODULE_FLAGS_NS = "tenant-module-flags";

export function invalidateTenantModuleFlags(tenantId: string): void {
  invalidateCached(MODULE_FLAGS_NS, tenantId);
}

export async function getTenantModuleFlags(tenantId: string): Promise<TenantModuleFlags> {
  return cached(MODULE_FLAGS_NS, tenantId, () => loadTenantModuleFlags(tenantId));
}

async function loadTenantModuleFlags(tenantId: string): Promise<TenantModuleFlags> {
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
