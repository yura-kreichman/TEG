"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";

// Тайл-квадратик с реальным градиентом (не абстрактная плашка) — тот же
// приём, что AccentPicker со SchemeSwatch: правило [data-bg-style="x"] в
// globals.css срабатывает на любом элементе с этим атрибутом, не только на
// .app-bg, так что превью — это буквально та же CSS-заливка в миниатюре, без
// отдельного live-preview механизма (по спеке он не нужен).
function StyleSwatch({
  style,
  label,
  selected,
  disabled,
  onClick,
}: {
  style: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-control border p-1.5 text-left transition-colors",
        selected ? "border-foreground" : "border-border hover:border-foreground/30"
      )}
    >
      {selected && (
        <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
          <Check className="size-3" />
        </span>
      )}
      <span
        data-bg-style={style === "none" ? undefined : style}
        className="flex h-9 overflow-hidden rounded-[10px] bg-surface-0"
      />
      <span className="truncate text-xs font-medium text-foreground">{label}</span>
    </button>
  );
}

export function BgStylePicker() {
  const t = useI18n();
  const labels: Record<string, string> = t.settings.bgStyleNames;
  const [options, setOptions] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>("none");
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/tenant/appearance")
      .then((res) => res.json())
      .then((data) => {
        setOptions(data.bgStyleOptions ?? []);
        setCurrent(data.bgStyle ?? "none");
      });
  }, []);

  async function handleSelect(style: string) {
    setSaving(true);
    setCurrent(style);
    const layer = document.getElementById("app-bg-layer");
    if (style === "none") {
      layer?.removeAttribute("data-bg-style");
    } else {
      layer?.setAttribute("data-bg-style", style);
    }
    await fetch("/api/tenant/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bgStyle: style }),
    });
    setSaving(false);
  }

  if (options.length === 0 || !mounted) return null;

  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((style) => (
        <StyleSwatch
          key={style}
          style={style}
          label={labels[style] ?? style}
          selected={current === style}
          disabled={saving}
          onClick={() => handleSelect(style)}
        />
      ))}
    </div>
  );
}
