"use client";

import { cn } from "@/lib/utils";

// Фиксированная палитра вместо нативного <input type="color"> (цветовое
// колесо) — фидбек пользователя 2026-07-09: цвета как у квадратиков-эмодзи
// (🟥🟧🟨🟩🟦🟪🟫⬛⬜), не произвольный подбор. Общая для Оператора и Актива.
export const COLOR_TAG_PALETTE = [
  "#EF4444", // 🟥
  "#F97316", // 🟧
  "#EAB308", // 🟨
  "#22C55E", // 🟩
  "#3B82F6", // 🟦
  "#A855F7", // 🟪
  "#92400E", // 🟫
  "#18181B", // ⬛
  "#F4F4F5", // ⬜
] as const;

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
