import { NextResponse } from "next/server";
import { isLocale, setPreAuthLocaleCookie } from "@/lib/i18n";

// Pre-auth language switch for /login, /register and the rest of the auth
// screen group (docs feedback 2026-07-10) — no session/tenant to write to yet,
// so this just sets a cookie; resolveLocale() picks it up as a fallback below
// any real session/tenant locale.
export async function POST(request: Request) {
  const { locale } = await request.json();
  if (typeof locale !== "string" || !isLocale(locale)) {
    return NextResponse.json({ error: "Некорректный язык" }, { status: 400 });
  }

  await setPreAuthLocaleCookie(locale);
  return NextResponse.json({ ok: true });
}
