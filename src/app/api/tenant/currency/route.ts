import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { CURRENCIES, isCurrencyCode } from "@/lib/currency";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { currency: true },
  });

  return NextResponse.json({ currency: tenant?.currency ?? null, options: CURRENCIES });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { currency } = await request.json();
  // null — "не указана" (по умолчанию, спека), явный сброс выбора.
  if (currency !== null && (typeof currency !== "string" || !isCurrencyCode(currency))) {
    return NextResponse.json({ error: "Некорректная валюта" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data: { currency } });

  return NextResponse.json({ ok: true });
}
