import { prisma } from "@/lib/prisma";

type ResolveResult =
  | { kind: "found"; tenantId: string }
  | { kind: "redirect"; currentSlug: string }
  | { kind: "not_found" };

// Общий резолвер тенанта по слагу для ОБОИХ публичных роутов, завязанных на
// Tenant.slug (/i/{slug}/... Инструктажей и /s/{slug} Лендинга,
// docs/spec/08-landing.md) — теперь, когда слаг редактируется владельцем
// (решение 2026-07-13), у обоих роутов должна быть одинаковая логика 301 на
// новый адрес при попадании в TenantOldSlug.
export async function resolveTenantBySlug(slug: string): Promise<ResolveResult> {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (tenant) return { kind: "found", tenantId: tenant.id };

  const old = await prisma.tenantOldSlug.findUnique({
    where: { slug },
    select: { tenant: { select: { slug: true } } },
  });
  if (old?.tenant.slug) return { kind: "redirect", currentSlug: old.tenant.slug };

  return { kind: "not_found" };
}
