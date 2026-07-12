"use client";

import { useEffect, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ALL_LOCALES, LOCALE_NAMES, LOCALE_FLAGS, type Locale } from "@/lib/locales";

/**
 * Pre-auth language switch for the login/register/etc. screen group — no
 * session/tenant yet, so it just flips a cookie (see /api/locale). Auto-detected
 * from Accept-Language on first load (see resolveLocale() in src/lib/i18n.ts);
 * this lets the visitor override it. Reads the active locale from <html lang>
 * (set server-side by RootLayout) rather than a new context, since useI18n()
 * only exposes the dictionary.
 *
 * A Select dropdown, not the old 4-pill row (2026-07-12) — with 14 languages
 * a row of pills no longer fits a phone screen; same component LocalePicker
 * already uses in Settings, for consistency.
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

  async function select(locale: string | null) {
    if (!locale || locale === current || saving) return;
    setSaving(true);
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    window.location.reload();
  }

  return (
    <Select value={current} onValueChange={select} disabled={saving}>
      <SelectTrigger className="h-9 w-auto min-w-32 px-3 text-sm">
        <SelectValue>
          {LOCALE_FLAGS[current as Locale]} {LOCALE_NAMES[current as Locale] ?? current}
        </SelectValue>
      </SelectTrigger>
      {/* grid-cols-3, ширина в vw с потолком — не 2 колонки фикс-ширины
          (фидбек 2026-07-12: сделать в 3 ряда и адаптивно, чтобы не вылезал
          за границы экрана). min(94vw,26rem) переопределяет дефолтный
          w-(--anchor-width) (иначе попап не шире триггера-кнопки). */}
      <SelectContent className="grid w-[min(94vw,26rem)] grid-cols-3 gap-1">
        {ALL_LOCALES.map((locale) => (
          <SelectItem key={locale} value={locale} className="gap-1.5 px-2">
            <span className="shrink-0">{LOCALE_FLAGS[locale]}</span>
            <span className="truncate">{LOCALE_NAMES[locale]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
