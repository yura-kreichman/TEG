import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { ACCENT_SCHEMES, isAccentScheme, setAccentCookie } from "@/lib/accent";
import { THEME_MODES, isThemeMode, setThemeModeCookie } from "@/lib/theme-mode";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { accentScheme: true, themeMode: true },
  });

  return NextResponse.json({
    accentScheme: tenant?.accentScheme ?? "green",
    accentOptions: ACCENT_SCHEMES,
    themeMode: tenant?.themeMode ?? "light",
    themeModeOptions: THEME_MODES,
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { accentScheme, themeMode } = await request.json();
  const data: { accentScheme?: string; themeMode?: string } = {};

  if (accentScheme !== undefined) {
    if (typeof accentScheme !== "string" || !isAccentScheme(accentScheme)) {
      return NextResponse.json({ error: "Некорректная акцентная схема" }, { status: 400 });
    }
    data.accentScheme = accentScheme;
  }

  if (themeMode !== undefined) {
    if (typeof themeMode !== "string" || !isThemeMode(themeMode)) {
      return NextResponse.json({ error: "Некорректный режим темы" }, { status: 400 });
    }
    data.themeMode = themeMode;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего сохранять" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  if (data.accentScheme) await setAccentCookie(data.accentScheme);
  if (data.themeMode) await setThemeModeCookie(data.themeMode);

  return NextResponse.json({ ok: true });
}
