"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

/**
 * Tenant-wide theme default — only the Owner can set this (docs/spec/03-design-system.md,
 * updated 2026-07-06). It becomes the starting theme for the Owner cabinet AND every
 * Operator's PWA; individual devices can still locally override via ThemeToggle without
 * changing this setting for anyone else.
 */
export function ThemeModePicker() {
  const router = useRouter();
  const t = useI18n();
  const [options, setOptions] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>("light");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/appearance")
      .then((res) => res.json())
      .then((data) => {
        setOptions(data.themeModeOptions ?? []);
        setCurrent(data.themeMode ?? "light");
      });
  }, []);

  async function handleSelect(mode: string) {
    setSaving(true);
    setCurrent(mode);
    await fetch("/api/tenant/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeMode: mode }),
    });
    setSaving(false);
    router.refresh();
  }

  if (options.length === 0) return null;

  return (
    <div className="flex gap-2">
      {options.map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={saving}
          onClick={() => handleSelect(mode)}
          className={cn(
            "flex items-center gap-2 rounded-control border px-3 py-2 text-sm transition-colors",
            current === mode ? "border-primary" : "border-border hover:bg-muted"
          )}
        >
          {mode === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          {mode === "dark" ? t.settings.themeDark : t.settings.themeLight}
        </button>
      ))}
    </div>
  );
}
