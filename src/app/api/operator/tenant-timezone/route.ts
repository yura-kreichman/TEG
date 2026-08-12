import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Часовой пояс ТЕНАНТА — общий на всех, личного переопределения у оператора
// нет (в отличие от языка). Аналог /api/tenant/timezone, но для сессии
// оператора: та требует владельца.
//
// Изначально появился ради read-only префикса телефона (2026-07-17), но
// префикс убран совсем 2026-08-13 (см. докстроку PhoneInput). Эндпоинт
// остался — его используют экраны, которым нужно показывать время в
// календаре тенанта, а не в поясе устройства.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = ctx;

  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { timezone: true } });
  return NextResponse.json({ timezone: tenant?.timezone ?? "UTC" });
}
