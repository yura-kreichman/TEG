import type { CSSProperties } from "react";
import { ACCENT_LAYER_OPACITIES } from "./shared";

// "Мерцающие искры" (запрос пользователя 2026-07-27) — точки акцентного
// цвета то появляются, то гаснут, без какого-либо движения — самый дешёвый
// эффект из всех (только opacity, GPU-композиция). 3 степени прозрачности,
// как у остальных эффектов (см. .sparkle-layer/@keyframes sparkle-pulse в
// globals.css, --peak-opacity — тот же приём, что у частиц).
const SPARKLES = [
  { opacity: ACCENT_LAYER_OPACITIES[0], left: "8%", bottom: "20%", size: 6, duration: "3.4s", delay: "0s" },
  { opacity: ACCENT_LAYER_OPACITIES[0], left: "88%", bottom: "60%", size: 5, duration: "4.1s", delay: "1.2s" },
  { opacity: ACCENT_LAYER_OPACITIES[1], left: "35%", bottom: "75%", size: 5, duration: "2.8s", delay: "0.6s" },
  { opacity: ACCENT_LAYER_OPACITIES[1], left: "60%", bottom: "15%", size: 6, duration: "3.6s", delay: "2s" },
  { opacity: ACCENT_LAYER_OPACITIES[2], left: "18%", bottom: "45%", size: 4, duration: "2.2s", delay: "0.3s" },
  { opacity: ACCENT_LAYER_OPACITIES[2], left: "75%", bottom: "35%", size: 4, duration: "2.6s", delay: "1.6s" },
] as const;

export function SparklesEffect() {
  return (
    <>
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="sparkle-layer absolute rounded-full"
          style={
            {
              left: s.left,
              bottom: s.bottom,
              width: s.size,
              height: s.size,
              backgroundColor: "var(--color-primary)",
              "--peak-opacity": s.opacity,
              animationDuration: s.duration,
              animationDelay: s.delay,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}
