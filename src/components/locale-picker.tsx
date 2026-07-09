"use client";

import { useEffect, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const LABELS: Record<string, string> = {
  ru: "Русский",
  en: "English",
  ro: "Română",
  uk: "Українська",
};

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
        <SelectValue>{LABELS[current] ?? current}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((locale) => (
          <SelectItem key={locale} value={locale}>
            {LABELS[locale] ?? locale}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
