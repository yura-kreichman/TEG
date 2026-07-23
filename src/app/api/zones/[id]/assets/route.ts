import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPackageLimit } from "@/lib/packages";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

const DEFAULT_COLOR_TAGS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/assets">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const { name, photoUrl, iconKey, colorTag, tariffId } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название актива обязательно" }, { status: 400 });
  }

  // Тариф — необязателен при создании (запрос пользователя 2026-07-17:
  // "если тарифы ещё не созданы, ничего страшного — потом создаст и
  // привяжет"), но если передан — обязан принадлежать этой же зоне.
  let tariffIdValue: string | null = null;
  if (tariffId !== undefined && tariffId !== null) {
    if (typeof tariffId !== "string") {
      return NextResponse.json({ error: "Некорректный тариф" }, { status: 400 });
    }
    const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
    if (!tariff || tariff.zoneId !== zoneId || tariff.deletedAt) {
      return NextResponse.json({ error: "Тариф не найден в этой зоне" }, { status: 400 });
    }
    tariffIdValue = tariffId;
  }

  // Счёт+проверка+создание под локом (аудит 2026-07-24) — maxAssets считается
  // по всему тенанту, тот же паттерн, что у Точек/Зон; заодно zoneAssetCount
  // (для sortOrder) теперь тоже читается под тем же локом, не отдельным
  // незащищённым запросом.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.tenantId}))`;
    const assetCount = await tx.asset.count({ where: { zone: { point: { tenantId: owner.tenantId } } } });
    const limitError = await checkPackageLimit(owner.tenantId, "maxAssets", assetCount);
    if (limitError) return { ok: false as const, limitError };

    // Порядок — в рамках зоны, не всего тенанта (assetCount выше — тенантный
    // счётчик для лимита пакета, для sortOrder нужен именно счёт внутри зоны).
    const zoneAssetCount = await tx.asset.count({ where: { zoneId } });

    const asset = await tx.asset.create({
      data: {
        zoneId,
        name: name.trim(),
        photoUrl: typeof photoUrl === "string" && photoUrl.trim() ? photoUrl.trim() : null,
        iconKey: typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null,
        colorTag:
          typeof colorTag === "string" && colorTag.trim()
            ? colorTag.trim()
            : DEFAULT_COLOR_TAGS[assetCount % DEFAULT_COLOR_TAGS.length],
        sortOrder: zoneAssetCount,
        tariffId: tariffIdValue,
      },
    });
    return { ok: true as const, asset };
  });
  if (!result.ok) return result.limitError;
  const asset = result.asset;

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json(
    { id: asset.id, name: asset.name, colorTag: asset.colorTag, photoUrl: asset.photoUrl, iconKey: asset.iconKey },
    { status: 201 }
  );
}
