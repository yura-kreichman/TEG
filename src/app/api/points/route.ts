import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPackageLimit } from "@/lib/packages";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const points = await prisma.point.findMany({
    where: { tenantId: owner.tenantId },
    include: { devices: true, _count: { select: { zones: true, openingHours: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    // hoursConfigured: см. docs/spec/08-landing.md, PointOpeningHours — все 7
    // строк разом или ни одной, поэтому "сколько есть" уже говорит "заполнены ли".
    points: points.map((p) => ({ ...p, zonesCount: p._count.zones, hoursConfigured: p._count.openingHours === 7 })),
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { name, address, iconKey } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название точки обязательно" }, { status: 400 });
  }

  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });
  const limitError = await checkPackageLimit(owner.tenantId, "maxPoints", pointCount);
  if (limitError) return limitError;

  const point = await prisma.point.create({
    data: {
      tenantId: owner.tenantId,
      name: name.trim(),
      address: typeof address === "string" && address.trim() ? address.trim() : null,
      iconKey: typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null,
    },
  });

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ id: point.id, name: point.name }, { status: 201 });
}
