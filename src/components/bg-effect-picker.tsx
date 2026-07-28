"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";
import { BG_EFFECT_VALUES, type BgEffect } from "@/components/bg-effects";
import { WavesEffect } from "@/components/bg-effects/waves";
import { ParticlesEffect } from "@/components/bg-effects/particles";
import { HyperspaceEffect } from "@/components/bg-effects/hyperspace";
import { AuroraEffect } from "@/components/bg-effects/aurora";
import { ShimmerEffect } from "@/components/bg-effects/shimmer";

// Живое превью — те же под-эффекты, что рендерятся по-настоящему (см.
// bg-effects/index.tsx), но БЕЗ обёртки BgEffectLayer: та использует
// position: fixed (на весь вьюпорт, так и задумано для реального
// применения), а тут нужен масштаб свотча — relative-рамка вместо fixed,
// иначе превью занимало бы весь экран поверх пикера.
function MiniEffectPreview({ effect }: { effect: Exclude<BgEffect, "none"> }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {effect === "waves" && <WavesEffect />}
      {effect === "particles" && <ParticlesEffect />}
      {effect === "hyperspace" && <HyperspaceEffect />}
      {effect === "aurora" && <AuroraEffect />}
      {effect === "shimmer" && <ShimmerEffect />}
    </div>
  );
}

function EffectSwatch({
  effect,
  label,
  selected,
  disabled,
  onClick,
}: {
  effect: BgEffect;
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
      <span className="relative flex h-9 overflow-hidden rounded-[10px] bg-surface-0">
        {effect !== "none" && <MiniEffectPreview effect={effect} />}
      </span>
      <span className="truncate text-xs font-medium text-foreground">{label}</span>
    </button>
  );
}

export function BgEffectPicker() {
  const t = useI18n();
  const labels = t.settings.bgEffectNames as Record<string, string>;
  const [current, setCurrent] = useState<BgEffect>("waves");
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/tenant/system-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setCurrent((data.bgEffect ?? "waves") as BgEffect);
      });
  }, []);

  async function handleSelect(effect: BgEffect) {
    setSaving(true);
    setCurrent(effect);
    // Мгновенно, ещё до ответа сервера (запрос пользователя 2026-07-27: "как
    // и фон он должен сразу меняться") — тот же принцип, что BgStylePicker
    // применяет к #app-bg-layer напрямую через DOM, только тут эффект — не
    // один элемент с атрибутом, а разные поддеревья, поэтому свой
    // CustomEvent с деталями вместо прямой DOM-мутации; owner-shell.tsx
    // слушает и обновляет своё состояние без ожидания fetch.
    window.dispatchEvent(new CustomEvent("bg-effect-changed", { detail: effect }));
    await fetch("/api/tenant/system-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bgEffect: effect }),
    });
    // owner-shell.tsx/operator-branding-chrome.tsx также перечитывают на
    // следующей навигации/событии модулей — подстраховка на случай других
    // открытых вкладок этого же владельца.
    window.dispatchEvent(new Event("tenant-modules-changed"));
    setSaving(false);
  }

  if (!mounted) return null;

  return (
    <div className="grid grid-cols-3 gap-2">
      {BG_EFFECT_VALUES.map((effect) => (
        <EffectSwatch
          key={effect}
          effect={effect}
          label={labels[effect] ?? effect}
          selected={current === effect}
          disabled={saving}
          onClick={() => handleSelect(effect)}
        />
      ))}
    </div>
  );
}
