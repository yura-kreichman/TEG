import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Часовой пояс ТЕНАНТА (не язык — Operator.locale личный и не говорит о
// стране, см. lib/locales.ts dialInfoForTimezone) — для read-only префикса
// телефона в модуле "Абонементы" (запрос пользователя 2026-07-17: "должен
// учитывать региональные настройки Владельца", уточнение того же дня: "мне
// удобен русский язык, но я живу в Молдове — это выбрано в часовом поясе").
// Аналог /api/tenant/timezone, но для сессии оператора — та требует владельца.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = ctx;

  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { timezone: true } });
  return NextResponse.json({ timezone: tenant?.timezone ?? "UTC" });
}
