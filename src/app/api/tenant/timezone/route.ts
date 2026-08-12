import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isSupportedTimezone } from "@/lib/locales";

// Принимается ЛЮБАЯ существующая зона IANA (запрос пользователя 2026-08-13).
// Белый список стран наших языков стоял и здесь — покупатель из США не мог
// выставить свой пояс даже прямым запросом; разбор в getAllowedTimezones
// (lib/locales.ts).
// Часовой пояс — общий для владельца и ВСЕХ его операторов (докстрока в
// Tenant.timezone, docs/spec/00-architecture.md) — задаёт только владелец,
// личного переопределения для оператора, в отличие от locale, нет.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { timezone: true } });
  return NextResponse.json({ timezone: tenant?.timezone ?? "UTC" });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { timezone } = await request.json();
  if (typeof timezone !== "string" || !isSupportedTimezone(timezone)) {
    return NextResponse.json({ error: "Некорректный часовой пояс" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data: { timezone } });
  return NextResponse.json({ ok: true });
}
