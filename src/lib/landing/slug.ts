import { prisma } from "@/lib/prisma";

// Короткий список — публичный путь живёт под /site/{slug} (docs/spec/
// 08-landing.md, решение пользователя 2026-07-13, снимает пересечение с
// корневыми роутами приложения), поэтому список нужен только для гигиены,
// не для защиты от коллизий с реальными маршрутами.
export const RESERVED_TENANT_SLUGS = ["site", "api", "admin", "app", "www", "static"];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUGS.includes(slug);
}

export function isValidSlugFormat(slug: string): boolean {
  return /^[a-z0-9-]{3,40}$/.test(slug);
}

// Слаг общий для Tenant.slug (Инструктажи + Лендинг, решение 2026-07-13) —
// уникальность проверяется и среди текущих слагов, и среди уже отработавших
// (TenantOldSlug), иначе кто-то мог бы "перехватить" чужой старый адрес.
// СВОИ собственные старые слаги excludeTenantId — не блокируют: найдено
// живым тестированием 2026-07-13(Шаг 7) — без этого исключения владелец,
// откатывающий переименование назад, не мог вернуть себе тот же адрес и
// получал "kidsburg-2" вместо честного "kidsburg".
export async function isSlugTaken(slug: string, excludeTenantId?: string): Promise<boolean> {
  const [tenant, oldSlug] = await Promise.all([
    prisma.tenant.findUnique({ where: { slug }, select: { id: true } }),
    prisma.tenantOldSlug.findUnique({ where: { slug }, select: { tenantId: true } }),
  ]);
  if (oldSlug && oldSlug.tenantId !== excludeTenantId) return true;
  if (tenant && tenant.id !== excludeTenantId) return true;
  return false;
}
