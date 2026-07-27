import { ACCENT_LAYER_OPACITIES } from "./shared";

// Декоративные волны под нижним баром (запрос пользователя 2026-07-27,
// "давай подумаем": "3 штуки с разной степенью прозрачности акцентного
// цвета") — один из нескольких эффектов на выбор (BgEffectPicker,
// Tenant.bgEffect). Только CSS-анимация (см. .wave-layer/@keyframes
// wave-drift в globals.css) — ни одной строчки JS в рендер-цикле, ноль
// нагрузки на телефон/компьютер; @media (prefers-reduced-motion: reduce)
// отключает анимацию вовсе.
//
// Один и тот же путь дважды подряд по X (0..1200 и 1200..2400) на ширине
// 200% контейнера — see globals.css для механики бесшовного цикла.
const WAVE_D =
  "M0,40 C150,90 350,-10 600,40 C850,90 1050,-10 1200,40 " +
  "C1350,90 1550,-10 1800,40 C2050,90 2250,-10 2400,40 L2400,120 L0,120 Z";

// bottom: 0 у всех слоёв (запрос пользователя 2026-07-27: "волны должны
// быть с самого низа страницы") — глубина слоя достигается разной ВЫСОТОЙ
// (дальние волны ниже/мельче), не смещением вверх от края, иначе край
// контейнера снизу остаётся пустым.
const LAYERS = [
  { opacity: ACCENT_LAYER_OPACITIES[0], duration: "26s", heightPct: 55, reverse: false },
  { opacity: ACCENT_LAYER_OPACITIES[1], duration: "18s", heightPct: 75, reverse: true },
  { opacity: ACCENT_LAYER_OPACITIES[2], duration: "13s", heightPct: 100, reverse: false },
] as const;

export function WavesEffect() {
  return (
    <>
      {LAYERS.map((layer, i) => (
        <svg
          key={i}
          viewBox="0 0 2400 120"
          preserveAspectRatio="none"
          className="wave-layer absolute inset-x-0 bottom-0 w-[200%]"
          style={{
            height: `${layer.heightPct}%`,
            opacity: layer.opacity,
            animationDuration: layer.duration,
            animationDirection: layer.reverse ? "reverse" : "normal",
          }}
        >
          <path d={WAVE_D} fill="var(--color-primary)" />
        </svg>
      ))}
    </>
  );
}
