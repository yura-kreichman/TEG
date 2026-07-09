"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const LOCALES = ["ru", "en", "ro", "uk"] as const;
const LABELS: Record<string, string> = { ru: "RU", en: "EN", ro: "RO", uk: "UA" };

/**
 * Pre-auth language switch for the login/register/etc. screen group — no
 * session/tenant yet, so it just flips a cookie (see /api/locale). Auto-detected
 * from Accept-Language on first load (see resolveLocale() in src/lib/i18n.ts);
 * this lets the visitor override it. Reads the active locale from <html lang>
 * (set server-side by RootLayout) rather than a new context, since useI18n()
 * only exposes the dictionary.
 *
 * Uses a full page reload, not router.refresh() — found 2026-07-10 that
 * router.refresh() wasn't reliably re-running the root layout (which resolves
 * the locale) in this Next.js version, so the picker looked like it did
 * nothing. A real navigation always re-resolves the cookie server-side.
 */
export function AuthLocalePicker() {
  const [current, setCurrent] = useState<string>("ru");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setCurrent(document.documentElement.lang || "ru");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function select(locale: string) {
    if (locale === current || saving) return;
    setSaving(true);
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    window.location.reload();
  }

  return (
    <div className="flex justify-center gap-1.5">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => select(locale)}
          disabled={saving}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
            locale === current
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
