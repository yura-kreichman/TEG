import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const [tenants, unmatchedWebhookCount] = await Promise.all([
    prisma.tenant.findMany({
      include: {
        package: { select: { id: true, name: true } },
        _count: { select: { points: true, operators: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Счётчик "непривязанных" вебхук-событий (доп. инструкция "связывание
    // тенанта с FluentCart", 2026-07-12, п.4) — только этот конкретный повод
    // отказа, не любой "failed" (внутренние ошибки — другое дело).
    prisma.webhookEvent.count({
      where: { provider: "fluentcart", error: "no matching tenant by email or customer_id" },
    }),
  ]);

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      subscriptionStatus: t.subscriptionStatus,
      subscriptionExpiresAt: t.subscriptionExpiresAt,
      package: t.package,
      pointsCount: t._count.points,
      operatorsCount: t._count.operators,
      createdAt: t.createdAt,
      fluentcartCustomerId: t.fluentcartCustomerId,
    })),
    unmatchedWebhookCount,
  });
}
