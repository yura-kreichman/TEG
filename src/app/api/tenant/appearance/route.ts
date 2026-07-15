import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { ACCENT_SCHEMES, isAccentScheme, setAccentCookie } from "@/lib/accent";
import { BG_STYLES, isBgStyle, setBgStyleCookie } from "@/lib/bg-style";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { accentScheme: true, bgStyle: true },
  });

  return NextResponse.json({
    accentScheme: tenant?.accentScheme ?? "green",
    accentOptions: ACCENT_SCHEMES,
    bgStyle: tenant?.bgStyle ?? "none",
    bgStyleOptions: BG_STYLES,
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { accentScheme, bgStyle } = await request.json();

  if (accentScheme !== undefined) {
    if (typeof accentScheme !== "string" || !isAccentScheme(accentScheme)) {
      return NextResponse.json({ error: "Некорректная акцентная схема" }, { status: 400 });
    }
    await prisma.tenant.update({ where: { id: owner.tenantId }, data: { accentScheme } });
    await setAccentCookie(accentScheme);
  }

  if (bgStyle !== undefined) {
    if (typeof bgStyle !== "string" || !isBgStyle(bgStyle)) {
      return NextResponse.json({ error: "Некорректный фон приложения" }, { status: 400 });
    }
    await prisma.tenant.update({ where: { id: owner.tenantId }, data: { bgStyle } });
    await setBgStyleCookie(bgStyle);
  }

  return NextResponse.json({ ok: true });
}
