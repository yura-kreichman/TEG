// Три степени прозрачности акцентного цвета — общие для всех фоновых
// эффектов (запрос пользователя 2026-07-27: "все эффекты, как и волны,
// должны предусматривать три степени акцентной схемы"), не только волн.
export const ACCENT_LAYER_OPACITIES = [0.12, 0.2, 0.3] as const;

export const BG_EFFECT_VALUES = ["none", "waves", "particles", "hyperspace", "aurora", "shimmer"] as const;
export type BgEffect = (typeof BG_EFFECT_VALUES)[number];

// "Искры" заменены "Гиперпространством" (запрос пользователя 2026-07-28:
// "заменить эффект Искры на классическое звёздное небо как в старых
// Windows"; согласовано — тот же CSS-only принцип, что у остальных
// эффектов, не canvas/rAF). Миграция значения не на уровне БД — старое
// "sparkles" у тенанта, выбравшего его раньше, просто трактуется как
// "hyperspace" при чтении (оба места чтения Tenant.bgEffect: api/tenant/
// system-settings/route.ts и api/operator/print-branding/route.ts),
// перезаписывается настоящим "hyperspace" при следующем сохранении.
export function normalizeBgEffect(value: string | null | undefined): BgEffect {
  if (value === "sparkles") return "hyperspace";
  return (BG_EFFECT_VALUES as readonly string[]).includes(value ?? "") ? (value as BgEffect) : "waves";
}

// Затухание к верхнему краю контейнера в 100% прозрачность (реальный баг,
// найден пользователем 2026-07-27, живой скриншот: "Свечение"/"Блик"
// выглядели обрезанными плашкой прямо у верхней границы) — Aurora/Shimmer
// используются в самом узком (36px, свотч) и самом широком (128px, реальный
// фон) контейнере разом, поэтому фикс — не "уменьшить пятно", а гарантия на
// уровне маски: какого бы размера ни было пятно/полоса, к верхнему краю
// контейнера оно ГАРАНТИРОВАННО сходит на нет.
export const TOP_FADE_MASK = "linear-gradient(to top, black 0%, black 35%, transparent 100%)";
