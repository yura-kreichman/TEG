import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isLocale, ALL_LOCALES } from "@/lib/i18n";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { locale: true },
  });

  return NextResponse.json({ locale: tenant?.locale ?? "ru", options: ALL_LOCALES });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { locale } = await request.json();
  if (typeof locale !== "string" || !isLocale(locale)) {
    return NextResponse.json({ error: "Некорректный язык" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data: { locale } });

  return NextResponse.json({ ok: true });
}
