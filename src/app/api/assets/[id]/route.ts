import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";

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

  const { name, photoUrl, iconKey, colorTag } = await request.json();
  const data: {
    name?: string;
    photoUrl?: string | null;
    iconKey?: string | null;
    colorTag?: string;
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

  await prisma.asset.update({ where: { id }, data });
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
  return NextResponse.json({ ok: true });
}
