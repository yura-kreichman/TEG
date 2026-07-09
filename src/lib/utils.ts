import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Custom radius/shadow tokens from docs/spec/03-design-system.md ("Визуальный
// язык", src/app/globals.css) aren't known to tailwind-merge's default class
// groups — without this, e.g. `rounded-xl rounded-card` would keep BOTH classes
// (no conflict detected) and whichever Tailwind emits last in the stylesheet
// would win, which is fragile. Extending the groups here makes `cn()` resolve
// these the same way it resolves the built-in scale.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: [{ rounded: ["control", "card", "block"] }],
      shadow: [{ shadow: ["card-rest", "card-hover", "floating"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Оператор/Актив хранят colorTag как #rrggbb (ColorTagPicker). Фон
// карточки/строки — не плоская заливка, а лёгкий градиент (фидбек
// пользователя 2026-07-09: "используй везде лёгкие градиенты, изменяй
// прозрачность в процентах немного" — первая версия с плоскими 20%
// оказалась слишком выраженной). CSS Color Level 4 hex-альфа (#rrggbb + 2
// hex-цифры) без rgba/color-mix парсинга; 26/0d ≈ 15%/5% — лёгкий переход,
// не сплошной цвет.
export function colorTagGradient(colorTag: string | null | undefined): string | undefined {
  if (!colorTag || !/^#[0-9a-fA-F]{6}$/.test(colorTag)) return undefined
  return `linear-gradient(135deg, ${colorTag}26, ${colorTag}0d)`
}
