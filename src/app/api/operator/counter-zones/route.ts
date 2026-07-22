import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Зоны, где применима оплата балансом БЕЗ Launch-учёта — "Счётчики" (выбор
// актив+тариф) и "Только касса" (сама зона) — docs/spec/01-counters.md,
// запрос пользователя 2026-07-20. Тот же список доступа, что и
// /api/operator/submission-context, но без тяжёлых показаний — тут нужны
// только сами зоны+активы+тарифы для пикера в экране "Клиенты".
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;
  if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id, active: true }
    : { pointId: point.id, active: true, operatorsWithAccess: { some: { id: operator.id } } };

  const zones = await prisma.zone.findMany({
    where: { ...zoneWhere, accountingMode: { in: ["counters", "cash_only"] } },
    include: {
      tariffs: { where: { deletedAt: null }, orderBy: { order: "asc" } },
      assets: { where: { active: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      iconKey: zone.iconKey,
      accountingMode: zone.accountingMode,
      tariffs: zone.tariffs.map((t) => ({ id: t.id, name: t.name, price: Number(t.price) })),
      assets: zone.assets.map((a) => ({
        id: a.id,
        name: a.name,
        photoUrl: a.photoUrl,
        iconKey: a.iconKey,
        colorTag: a.colorTag,
      })),
    })),
  });
}
