import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { CLEANUP_INCLUDE, CLEANUP_MIN_AGE_DAYS, classifyTenant, countsOf, daysSince } from "@/lib/admin/tenant-cleanup";
import { describeTenantRegion } from "@/lib/admin/tenant-region";

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const [tenants, unmatchedWebhookCount] = await Promise.all([
    prisma.tenant.findMany({
      include: CLEANUP_INCLUDE,
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
      // Откуда клиент (запрос владельца 2026-08-22) — считаем на сервере,
      // чтобы список и карточка тенанта говорили одно и то же.
      region: describeTenantRegion(t.timezone),
      fluentcartCustomerId: t.fluentcartCustomerId,
      unlimited: t.unlimited,
      // Анализ "потерянных клиентов" (см. src/lib/admin/tenant-cleanup.ts).
      // Считается на сервере, а не в браузере: тот же модуль потом решает,
      // кого реально можно удалить, и два независимых критерия разъехались
      // бы при первой же правке.
      cleanupVerdict: classifyTenant(t, countsOf(t)),
      ageDays: daysSince(t.createdAt),
    })),
    unmatchedWebhookCount,
    cleanupMinAgeDays: CLEANUP_MIN_AGE_DAYS,
  });
}
