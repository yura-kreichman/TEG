import type { BgEffect } from "./shared";
import { WavesEffect } from "./waves";
import { ParticlesEffect } from "./particles";
import { SparklesEffect } from "./sparkles";
import { AuroraEffect } from "./aurora";
import { ShimmerEffect } from "./shimmer";

export { BG_EFFECT_VALUES, type BgEffect } from "./shared";

/**
 * Декоративный фоновый эффект под нижним баром (запрос пользователя
 * 2026-07-27, "давай подумаем": сначала волны, затем "что ещё на выбор...
 * не грузило процессор") — общий контейнер + диспетчер по Tenant.bgEffect,
 * у Владельца и в PWA Сотрудника (owner-shell.tsx/operator-branding-chrome.tsx).
 * z-index: -1 — та же глубина, что у .app-bg (globals.css), но позже в DOM,
 * поэтому рисуется ПОВЕРХ узора и ПОД нижним стеклянным баром (у него
 * z-index: auto) — эффект просвечивает сквозь blur бара, не перекрывает
 * обычный контент. Каждый под-эффект — чистый CSS (transform/opacity),
 * ни одной строчки JS в рендер-цикле; @media (prefers-reduced-motion:
 * reduce) отключает анимацию на уровне globals.css.
 */
export function BgEffectLayer({ effect }: { effect: BgEffect }) {
  if (effect === "none") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 h-32 overflow-hidden" style={{ zIndex: -1 }}>
      {effect === "waves" && <WavesEffect />}
      {effect === "particles" && <ParticlesEffect />}
      {effect === "sparkles" && <SparklesEffect />}
      {effect === "aurora" && <AuroraEffect />}
      {effect === "shimmer" && <ShimmerEffect />}
    </div>
  );
}
