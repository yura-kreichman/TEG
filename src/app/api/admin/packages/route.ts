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
      modules: p.modules,
      maxPoints: p.maxPoints,
      maxZones: p.maxZones,
      maxAssets: p.maxAssets,
      maxOperators: p.maxOperators,
      priceMonthly: p.priceMonthly.toString(),
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

  const pkg = await prisma.package.create({ data: payload });
  return NextResponse.json({ id: pkg.id }, { status: 201 });
}
