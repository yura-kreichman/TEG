import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";

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

  const assetCount = await prisma.asset.count({ where: { zone: { point: { tenantId: owner.tenantId } } } });
  const pkg = await prisma.tenant
    .findUnique({ where: { id: owner.tenantId }, include: { package: true } })
    .then((t) => t?.package);
  if (pkg && assetCount >= pkg.maxAssets) {
    return NextResponse.json(
      { error: `Достигнут лимит активов по вашему пакету (${pkg.maxAssets})` },
      { status: 409 }
    );
  }

  const { name, photoUrl, iconKey, colorTag } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название актива обязательно" }, { status: 400 });
  }

  const asset = await prisma.asset.create({
    data: {
      zoneId,
      name: name.trim(),
      photoUrl: typeof photoUrl === "string" && photoUrl.trim() ? photoUrl.trim() : null,
      iconKey: typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null,
      colorTag:
        typeof colorTag === "string" && colorTag.trim()
          ? colorTag.trim()
          : DEFAULT_COLOR_TAGS[assetCount % DEFAULT_COLOR_TAGS.length],
    },
  });

  return NextResponse.json(
    { id: asset.id, name: asset.name, colorTag: asset.colorTag, photoUrl: asset.photoUrl, iconKey: asset.iconKey },
    { status: 201 }
  );
}
