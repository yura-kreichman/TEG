"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";

export function AccentPicker() {
  const router = useRouter();
  const t = useI18n();
  const labels: Record<string, string> = t.settings.accentNames;
  const [options, setOptions] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>("green");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/appearance")
      .then((res) => res.json())
      .then((data) => {
        setOptions(data.accentOptions ?? []);
        setCurrent(data.accentScheme ?? "green");
      });
  }, []);

  async function handleSelect(scheme: string) {
    setSaving(true);
    setCurrent(scheme);
    await fetch("/api/tenant/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accentScheme: scheme }),
    });
    setSaving(false);
    router.refresh();
  }

  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {options.map((scheme) => (
        <button
          key={scheme}
          type="button"
          disabled={saving}
          onClick={() => handleSelect(scheme)}
          title={labels[scheme] ?? scheme}
          aria-label={labels[scheme] ?? scheme}
          aria-pressed={current === scheme}
          data-accent={scheme}
          className={cn(
            "size-9 rounded-control ring-offset-2 ring-offset-background transition-shadow",
            current === scheme ? "ring-2 ring-foreground" : "ring-1 ring-black/10 hover:ring-black/20"
          )}
          style={{ backgroundColor: "var(--primary)" }}
        />
      ))}
    </div>
  );
}
