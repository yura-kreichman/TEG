import { ACCENT_LAYER_OPACITIES, TOP_FADE_MASK } from "./shared";

// "Дрейф сияния" (запрос пользователя 2026-07-27) — мягкие размытые пятна
// акцентного цвета медленно "гуляют" по фону. Только transform (см.
// .aurora-layer/@keyframes aurora-drift в globals.css) — opacity тут
// анимацией не тронут, поэтому инлайн-стиль ниже задаёт его напрямую, без
// --peak-opacity трюка (в отличие от particles/sparkles). blur — filter,
// тоже GPU-слой, считается один раз на отрисовку кадра композитором, не
// пересчитывается покадрово в JS.
// Скорость — запрос пользователя 2026-07-27: "должно быть быстрее, не видно
// движения" (первая версия 26s/19s/14s была рассчитана на фон, который
// смотрят краем глаза часами, но на глаз в моменте движение действительно
// терялось).
const BLOBS = [
  { opacity: ACCENT_LAYER_OPACITIES[0], size: "26rem", left: "-6%", bottom: "-10%", duration: "9s" },
  { opacity: ACCENT_LAYER_OPACITIES[1], size: "18rem", left: "55%", bottom: "-14%", duration: "6.5s" },
  { opacity: ACCENT_LAYER_OPACITIES[2], size: "12rem", left: "25%", bottom: "-6%", duration: "4.5s" },
] as const;

export function AuroraEffect() {
  return (
    <div
      className="absolute inset-0"
      style={{ maskImage: TOP_FADE_MASK, WebkitMaskImage: TOP_FADE_MASK }}
    >
      {BLOBS.map((b, i) => (
        <span
          key={i}
          className="aurora-layer absolute rounded-full"
          style={{
            left: b.left,
            bottom: b.bottom,
            width: b.size,
            height: b.size,
            backgroundColor: "var(--color-primary)",
            opacity: b.opacity,
            filter: "blur(40px)",
            animationDuration: b.duration,
          }}
        />
      ))}
    </div>
  );
}
