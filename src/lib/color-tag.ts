// Общая фиксированная палитра цветовых меток Оператора/Актива (см.
// ColorTagPicker) — каждый цвет подобран под конкретный Unicode-эмодзи
// цветного квадрата (фидбек пользователя 2026-07-09), что позволяет
// показывать метку и вне UI, например эмодзи рядом с именем оператора в
// Telegram-сводке (telegram-format.ts, фидбек пользователя 2026-07-12).
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

const COLOR_TAG_EMOJI: Record<string, string> = {
  "#EF4444": "🟥",
  "#F97316": "🟧",
  "#EAB308": "🟨",
  "#22C55E": "🟩",
  "#3B82F6": "🟦",
  "#A855F7": "🟪",
  "#92400E": "🟫",
  "#18181B": "⬛",
  "#F4F4F5": "⬜",
};

export function colorTagToEmoji(colorTag: string | null | undefined): string | null {
  if (!colorTag) return null;
  return COLOR_TAG_EMOJI[colorTag.toUpperCase()] ?? null;
}
