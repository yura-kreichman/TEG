import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { ACCENT_SCHEMES, isAccentScheme, setAccentCookie } from "@/lib/accent";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { accentScheme: true },
  });

  return NextResponse.json({
    accentScheme: tenant?.accentScheme ?? "green",
    accentOptions: ACCENT_SCHEMES,
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { accentScheme } = await request.json();

  if (typeof accentScheme !== "string" || !isAccentScheme(accentScheme)) {
    return NextResponse.json({ error: "Некорректная акцентная схема" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data: { accentScheme } });
  await setAccentCookie(accentScheme);

  return NextResponse.json({ ok: true });
}
