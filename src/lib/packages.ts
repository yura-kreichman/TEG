import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export interface PackagePayload {
  name: string;
  maxPoints: number;
  maxZones: number;
  maxAssets: number;
  maxOperators: number;
  priceMonthly: number;
  fluentcartProductId: string | null;
}

// Модули больше не различаются по пакетам (фидбек пользователя 2026-07-12:
// "во всех пакетах работают все модули... разница пакетов только в
// лимитах") — валидация модулей убрана вместе с самим полем.
export function validatePackagePayload(body: unknown): PackagePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string" || b.name.trim().length === 0) return null;
  for (const key of ["maxPoints", "maxZones", "maxAssets", "maxOperators"] as const) {
    if (typeof b[key] !== "number" || !Number.isInteger(b[key]) || (b[key] as number) < 0) return null;
  }
  const price = Number(b.priceMonthly);
  if (!Number.isFinite(price) || price < 0) return null;
  if (b.fluentcartProductId !== undefined && b.fluentcartProductId !== null && typeof b.fluentcartProductId !== "string") {
    return null;
  }

  return {
    name: (b.name as string).trim(),
    maxPoints: b.maxPoints as number,
    maxZones: b.maxZones as number,
    maxAssets: b.maxAssets as number,
    maxOperators: b.maxOperators as number,
    priceMonthly: price,
    fluentcartProductId:
      typeof b.fluentcartProductId === "string" && b.fluentcartProductId.trim() ? b.fluentcartProductId.trim() : null,
  };
}

const LIMIT_LABELS = {
  maxPoints: "точек",
  maxZones: "зон",
  maxAssets: "активов",
  maxOperators: "операторов",
} as const;

export interface TenantLimits {
  maxPoints: number;
  maxZones: number;
  maxAssets: number;
  maxOperators: number;
}

/**
 * Эффективные лимиты тенанта (docs/spec/06-super-admin.md) — Tenant.limitOverrides
 * поверх значений пакета. Используется остальными модулями (Counters, Tasks
 * и т.д.) при проверке лимитов — единственное место, где нужно решать
 * "оверрайд или пакет", чтобы Super Admin'ский ручной оверрайд лимита
 * реально на что-то влиял, а не только хранился в БД.
 */
export async function getTenantLimits(tenantId: string): Promise<TenantLimits | null> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { package: true } });
  if (!tenant) return null;

  // Tenant.unlimited — ручной рубильник Super Admin'а (запрос пользователя
  // 2026-07-17: "пакет Unlimited без ограничений, которого нет в пакетах"),
  // проверяется РАНЬШЕ limitOverrides — снимает все 4 лимита разом, вместо
  // того чтобы Super Admin вручную вбивал огромные числа в оверрайды.
  // Infinity живёт только на сервере (checkPackageLimit ниже) — наружу через
  // JSON.stringify не уходит (превратилось бы в null), поэтому API-роуты,
  // отдающие лимиты наружу, читают tenant.unlimited отдельно и сами решают,
  // что показать (см. /api/tenant/usage, /api/admin/tenants/[id]).
  if (tenant.unlimited) {
    return { maxPoints: Infinity, maxZones: Infinity, maxAssets: Infinity, maxOperators: Infinity };
  }

  const overrides = (tenant.limitOverrides as Partial<TenantLimits> | null) ?? {};
  return {
    maxPoints: overrides.maxPoints ?? tenant.package.maxPoints,
    maxZones: overrides.maxZones ?? tenant.package.maxZones,
    maxAssets: overrides.maxAssets ?? tenant.package.maxAssets,
    maxOperators: overrides.maxOperators ?? tenant.package.maxOperators,
  };
}

/**
 * Checks a tenant's current usage of one resource against their effective
 * limit (package, with Super Admin's per-tenant override on top — see
 * getTenantLimits). Returns a ready-to-return 409 NextResponse if the limit
 * is reached, or null if the tenant may create another (no package assigned
 * = no limit enforced).
 */
export async function checkPackageLimit(
  tenantId: string,
  limitKey: keyof TenantLimits,
  currentCount: number
) {
  const limits = await getTenantLimits(tenantId);

  if (limits && currentCount >= limits[limitKey]) {
    return NextResponse.json(
      { error: `Достигнут лимит ${LIMIT_LABELS[limitKey]} по вашему пакету (${limits[limitKey]})` },
      { status: 409 }
    );
  }

  return null;
}
