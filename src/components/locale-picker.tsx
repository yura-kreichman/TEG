"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  ru: "Русский",
  en: "English",
  ro: "Română",
};

/** Tenant-wide default language — set only by the Owner (docs/spec/00-architecture.md). */
export function LocalePicker() {
  const router = useRouter();
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

  async function handleSelect(locale: string) {
    setSaving(true);
    setCurrent(locale);
    await fetch("/api/tenant/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    setSaving(false);
    router.refresh();
  }

  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((locale) => (
        <button
          key={locale}
          type="button"
          disabled={saving}
          onClick={() => handleSelect(locale)}
          className={cn(
            "rounded-control border px-3 py-2 text-sm transition-colors",
            current === locale ? "border-primary" : "border-border hover:bg-muted"
          )}
        >
          {LABELS[locale] ?? locale}
        </button>
      ))}
    </div>
  );
}
