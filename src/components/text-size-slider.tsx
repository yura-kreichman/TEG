"use client";

import { TEXT_SCALE_STEPS, useTextScale, type TextScale } from "@/components/text-scale-provider";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

const STEP_LABELS: Record<TextScale, string> = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL" };

export function TextSizeSlider() {
  const t = useI18n();
  const { scale, setScale } = useTextScale();
  const index = TEXT_SCALE_STEPS.indexOf(scale);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="range"
        min={0}
        max={TEXT_SCALE_STEPS.length - 1}
        step={1}
        value={index}
        onChange={(e) => setScale(TEXT_SCALE_STEPS[Number(e.target.value)])}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        aria-label={t.settings.textSizeLabel}
      />
      <div className="flex justify-between text-[0.6875rem] font-semibold text-muted-foreground">
        {TEXT_SCALE_STEPS.map((step) => (
          <span key={step} className={cn(step === scale && "text-primary")}>
            {STEP_LABELS[step]}
          </span>
        ))}
      </div>
    </div>
  );
}
