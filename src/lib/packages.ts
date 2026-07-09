import { MODULE_KEYS } from "@/lib/modules";

export interface PackagePayload {
  name: string;
  modules: string[];
  maxPoints: number;
  maxZones: number;
  maxAssets: number;
  maxOperators: number;
  priceMonthly: number;
}

export function validatePackagePayload(body: unknown): PackagePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string" || b.name.trim().length === 0) return null;
  if (!Array.isArray(b.modules) || !b.modules.every((m) => MODULE_KEYS.includes(m))) return null;
  for (const key of ["maxPoints", "maxZones", "maxAssets", "maxOperators"] as const) {
    if (typeof b[key] !== "number" || !Number.isInteger(b[key]) || (b[key] as number) < 0) return null;
  }
  const price = Number(b.priceMonthly);
  if (!Number.isFinite(price) || price < 0) return null;

  return {
    name: (b.name as string).trim(),
    modules: b.modules as string[],
    maxPoints: b.maxPoints as number,
    maxZones: b.maxZones as number,
    maxAssets: b.maxAssets as number,
    maxOperators: b.maxOperators as number,
    priceMonthly: price,
  };
}
