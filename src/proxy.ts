import { NextResponse, type NextRequest } from "next/server";

// Marks pre-auth screens so resolveLocale() (src/lib/i18n.ts) ignores any
// lingering session cookie for language purposes on these paths — found
// 2026-07-10: testing the login-page language picker while already logged in
// as Owner/Admin/Operator in the same browser made the switcher look broken,
// since the real account's locale always won over the pre-auth cookie. On
// these paths specifically, the visitor isn't "using the app as that
// account" yet, so their picked language should always show.
//
// Named `proxy.ts` (not `middleware.ts`) — this Next.js version deprecated
// and renamed the file convention, see node_modules/next/dist/docs/.../proxy.md.
const PRE_AUTH_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/set-pin",
  "/activate-device",
  "/operator/login",
  "/admin/login",
];

export function proxy(request: NextRequest) {
  const isPreAuthPage = PRE_AUTH_PATHS.some(
    (path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`)
  );
  if (!isPreAuthPage) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set("x-pre-auth-page", "1");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
