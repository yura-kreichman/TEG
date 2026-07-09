import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const tenants = await prisma.tenant.findMany({
    include: {
      package: { select: { id: true, name: true } },
      _count: { select: { points: true, operators: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      subscriptionStatus: t.subscriptionStatus,
      subscriptionExpiresAt: t.subscriptionExpiresAt,
      trialEndsAt: t.trialEndsAt,
      package: t.package,
      pointsCount: t._count.points,
      operatorsCount: t._count.operators,
      createdAt: t.createdAt,
    })),
  });
}
