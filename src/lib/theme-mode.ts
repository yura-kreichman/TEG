import { cookies } from "next/headers";

// Theme mode is a tenant-wide default (docs/spec/03-design-system.md, spec update
// 2026-07-06): only the Owner can change it, and it applies to the Owner cabinet
// AND every Operator's PWA out of the box. Mirrored into a small non-secret
// cookie (same pattern as src/lib/accent.ts) so the root/operator layouts can set
// next-themes' `defaultTheme` synchronously with no flash. Any individual browser
// can still locally override light/dark via the ThemeToggle — that's next-themes'
// own localStorage mechanism layered on top, and never changes this tenant default.
const THEME_MODE_COOKIE = "theme_mode";
const THEME_MODE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const THEME_MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export function isThemeMode(value: string): value is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(value);
}

export async function setThemeModeCookie(mode: string) {
  const cookieStore = await cookies();
  cookieStore.set(THEME_MODE_COOKIE, isThemeMode(mode) ? mode : "light", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THEME_MODE_MAX_AGE,
  });
}

export async function getThemeModeCookie(): Promise<ThemeMode> {
  const cookieStore = await cookies();
  const value = cookieStore.get(THEME_MODE_COOKIE)?.value;
  return value && isThemeMode(value) ? value : "light";
}
