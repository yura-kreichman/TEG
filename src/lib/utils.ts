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
