import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { validatePackagePayload } from "@/lib/packages";

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const packages = await prisma.package.findMany({
    include: { _count: { select: { tenants: true } } },
    orderBy: { priceMonthly: "asc" },
  });

  return NextResponse.json({
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      maxPoints: p.maxPoints,
      maxZones: p.maxZones,
      maxAssets: p.maxAssets,
      maxOperators: p.maxOperators,
      priceMonthly: p.priceMonthly.toString(),
      fluentcartProductId: p.fluentcartProductId,
      tenantsCount: p._count.tenants,
    })),
  });
}

export async function POST(request: Request) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const payload = validatePackagePayload(await request.json());
  if (!payload) {
    return NextResponse.json({ error: "Некорректные данные пакета" }, { status: 400 });
  }

  if (payload.fluentcartProductId) {
    const conflict = await prisma.package.findUnique({ where: { fluentcartProductId: payload.fluentcartProductId } });
    if (conflict) {
      return NextResponse.json({ error: "Этот product_id уже привязан к другому пакету" }, { status: 409 });
    }
  }

  const pkg = await prisma.package.create({ data: payload });
  return NextResponse.json({ id: pkg.id }, { status: 201 });
}
