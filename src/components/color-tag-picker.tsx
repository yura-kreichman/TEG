"use client";

import { cn } from "@/lib/utils";
import { COLOR_TAG_PALETTE } from "@/lib/color-tag";

// Фиксированная палитра вместо нативного <input type="color"> (цветовое
// колесо) — фидбек пользователя 2026-07-09: цвета как у квадратиков-эмодзи
// (🟥🟧🟨🟩🟦🟪🟫⬛⬜), не произвольный подбор. Общая для Оператора и Актива.
// Сама палитра — в lib/color-tag.ts (общий модуль, не "use client"), чтобы
// её мог использовать и telegram-format.ts (эмодзи рядом с оператором в сводке).
export { COLOR_TAG_PALETTE };

export function ColorTagPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLOR_TAG_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={color}
          aria-pressed={value.toLowerCase() === color.toLowerCase()}
          className={cn(
            "size-9 rounded-control border border-black/10 ring-offset-2 ring-offset-background transition-shadow",
            value.toLowerCase() === color.toLowerCase()
              ? "ring-2 ring-foreground"
              : "ring-1 ring-transparent hover:ring-black/10"
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
