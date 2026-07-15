import { cookies } from "next/headers";

// Фон приложения — тенантная настройка (docs/spec/03-design-system.md, "Фон
// приложения"), только кабинет владельца. Зеркалируется в некритичную куку
// по тому же паттерну, что и accent_scheme (src/lib/accent.ts) — чтобы
// RootLayout мог поставить data-bg-style на <html> синхронно, без вспышки.
const BG_STYLE_COOKIE = "bg_style";
const BG_STYLE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const BG_STYLES = ["none", "shine", "haze", "silk", "halftone", "ribbons"] as const;
export type BgStyle = (typeof BG_STYLES)[number];

export function isBgStyle(value: string): value is BgStyle {
  return (BG_STYLES as readonly string[]).includes(value);
}

export async function setBgStyleCookie(style: string) {
  const cookieStore = await cookies();
  cookieStore.set(BG_STYLE_COOKIE, isBgStyle(style) ? style : "none", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BG_STYLE_MAX_AGE,
  });
}

export async function getBgStyleCookie(): Promise<BgStyle> {
  const cookieStore = await cookies();
  const value = cookieStore.get(BG_STYLE_COOKIE)?.value;
  return value && isBgStyle(value) ? value : "none";
}
