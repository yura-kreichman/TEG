import type { CSSProperties } from "react";
import { ACCENT_LAYER_OPACITIES } from "./shared";

// "Частицы вверх" (запрос пользователя 2026-07-27, "давай подумаем" по
// эффектам фона) — маленькие кружки медленно всплывают и растворяются,
// 3 степени прозрачности акцентного цвета, как у волн. Только
// transform+opacity (см. .particle-layer/@keyframes particle-rise в
// globals.css) — GPU-композиция, ноль JS.
const PARTICLES = [
  { opacity: ACCENT_LAYER_OPACITIES[0], left: "12%", size: 10, duration: "9s", delay: "0s" },
  { opacity: ACCENT_LAYER_OPACITIES[0], left: "68%", size: 8, duration: "11s", delay: "3s" },
  { opacity: ACCENT_LAYER_OPACITIES[1], left: "30%", size: 7, duration: "7.5s", delay: "1.5s" },
  { opacity: ACCENT_LAYER_OPACITIES[1], left: "82%", size: 9, duration: "8.5s", delay: "4.5s" },
  { opacity: ACCENT_LAYER_OPACITIES[2], left: "50%", size: 6, duration: "6s", delay: "0.8s" },
  { opacity: ACCENT_LAYER_OPACITIES[2], left: "20%", size: 5, duration: "5.5s", delay: "3.6s" },
] as const;

export function ParticlesEffect() {
  return (
    <>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="particle-layer absolute bottom-2 rounded-full"
          style={
            {
              left: p.left,
              width: p.size,
              height: p.size,
              backgroundColor: "var(--color-primary)",
              "--peak-opacity": p.opacity,
              animationDuration: p.duration,
              animationDelay: p.delay,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}
