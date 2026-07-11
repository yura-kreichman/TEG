import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Валидный список IANA-зон берём у самого Node (Intl.supportedValuesOf),
// а не хардкодим — тот же приём, что и с открытым списком модулей: список
// всегда актуален для той версии рантайма, что реально исполняет код.
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

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
  if (typeof timezone !== "string" || !VALID_TIMEZONES.has(timezone)) {
    return NextResponse.json({ error: "Некорректный часовой пояс" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data: { timezone } });
  return NextResponse.json({ ok: true });
}
