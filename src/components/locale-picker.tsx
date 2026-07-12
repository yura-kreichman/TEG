"use client";

import { useEffect, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { LOCALE_NAMES, LOCALE_FLAGS } from "@/lib/locales";

/**
 * Tenant-wide default language — set only by the Owner (docs/spec/00-architecture.md).
 * Full page reload after saving, not router.refresh() — same fix as
 * AuthLocalePicker (2026-07-10): router.refresh() wasn't reliably re-running
 * the root layout that resolves the locale in this Next.js version.
 */
export function LocalePicker() {
  const [options, setOptions] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>("ru");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/locale")
      .then((res) => res.json())
      .then((data) => {
        setOptions(data.options ?? []);
        setCurrent(data.locale ?? "ru");
      });
  }, []);

  async function handleSelect(locale: string | null) {
    if (!locale) return;
    setSaving(true);
    setCurrent(locale);
    await fetch("/api/tenant/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    window.location.reload();
  }

  if (options.length === 0) return null;

  return (
    <Select value={current} onValueChange={handleSelect} disabled={saving}>
      <SelectTrigger className="max-w-xs">
        <SelectValue>
          {LOCALE_FLAGS[current as keyof typeof LOCALE_FLAGS]}{" "}
          {LOCALE_NAMES[current as keyof typeof LOCALE_NAMES] ?? current}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="grid w-[min(94vw,26rem)] grid-cols-3 gap-1">
        {options.map((locale) => (
          <SelectItem key={locale} value={locale} className="gap-1.5 px-2">
            <span className="shrink-0">{LOCALE_FLAGS[locale as keyof typeof LOCALE_FLAGS]}</span>
            <span className="truncate">{LOCALE_NAMES[locale as keyof typeof LOCALE_NAMES] ?? locale}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
