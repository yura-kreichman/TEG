import { cookies } from "next/headers";

// Accent scheme is a tenant setting (docs/spec/00-architecture.md), not a
// per-request DB lookup — we mirror it into a small non-secret cookie whenever
// it's read/changed (login, register, settings save) so the root layout can
// set `data-accent` on <html> synchronously with no flash/client round-trip.
const ACCENT_COOKIE = "accent_scheme";
const ACCENT_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const ACCENT_SCHEMES = ["green", "blue", "orange", "purple", "teal", "coral", "pink", "indigo", "amber"] as const;
export type AccentScheme = (typeof ACCENT_SCHEMES)[number];

export function isAccentScheme(value: string): value is AccentScheme {
  return (ACCENT_SCHEMES as readonly string[]).includes(value);
}

export async function setAccentCookie(scheme: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACCENT_COOKIE, isAccentScheme(scheme) ? scheme : "green", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCENT_MAX_AGE,
  });
}

export async function getAccentCookie(): Promise<AccentScheme> {
  const cookieStore = await cookies();
  const value = cookieStore.get(ACCENT_COOKIE)?.value;
  return value && isAccentScheme(value) ? value : "green";
}
