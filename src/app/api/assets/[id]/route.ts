import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

async function findOwnedAsset(tenantId: string, id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: { zone: { include: { point: true } } },
  });
  if (!asset || asset.zone.point.tenantId !== tenantId) return null;
  return asset;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await findOwnedAsset(owner.tenantId, id);
  if (!asset) {
    return NextResponse.json({ error: "Актив не найден" }, { status: 404 });
  }

  const { name, photoUrl, iconKey, colorTag, active, tariffId } = await request.json();
  const data: {
    name?: string;
    photoUrl?: string | null;
    iconKey?: string | null;
    colorTag?: string;
    active?: boolean;
    tariffId?: string | null;
  } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название актива обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (photoUrl !== undefined) {
    const nextPhotoUrl = typeof photoUrl === "string" && photoUrl.trim() ? photoUrl.trim() : null;
    if (asset.photoUrl && asset.photoUrl !== nextPhotoUrl) {
      await deleteUploadedImage(asset.photoUrl);
    }
    data.photoUrl = nextPhotoUrl;
  }
  if (iconKey !== undefined) {
    data.iconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
  }
  if (colorTag !== undefined) {
    if (typeof colorTag !== "string" || colorTag.trim().length === 0) {
      return NextResponse.json({ error: "Цвет обязателен" }, { status: 400 });
    }
    data.colorTag = colorTag.trim();
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение active" }, { status: 400 });
    }
    data.active = active;
  }
  // Тариф режима "Прибывания" — актив ссылается на один из тарифов СВОЕЙ
  // зоны (запрос пользователя 2026-07-17: тарифы и активы создаются
  // независимо, привязка отдельным действием, можно оставить пустой).
  if (tariffId !== undefined) {
    if (tariffId === null) {
      data.tariffId = null;
    } else {
      if (typeof tariffId !== "string") {
        return NextResponse.json({ error: "Некорректный тариф" }, { status: 400 });
      }
      const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
      if (!tariff || tariff.zoneId !== asset.zoneId || tariff.deletedAt) {
        return NextResponse.json({ error: "Тариф не найден в этой зоне" }, { status: 400 });
      }
      data.tariffId = tariffId;
    }
  }

  await prisma.asset.update({ where: { id }, data });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await findOwnedAsset(owner.tenantId, id);
  if (!asset) {
    return NextResponse.json({ error: "Актив не найден" }, { status: 404 });
  }

  await prisma.asset.delete({ where: { id } });
  await deleteUploadedImage(asset.photoUrl);
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
