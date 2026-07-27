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
 * Каждый под-эффект — чистый CSS (transform/opacity), ни одной строчки JS
 * в рендер-цикле; @media (prefers-reduced-motion: reduce) отключает
 * анимацию на уровне globals.css.
 *
 * z-index: -1 — реальный баг, найден пользователем 2026-07-27 дважды, в
 * разные стороны: сначала отрицательный z-index прятался за bg-surface-0
 * (полотно страницы, полностью непрозрачно на устройстве без выбранного
 * "Фон приложения" — временно переводили на z-index: 1), но тогда эффект
 * стал всплывать ПОВЕРХ карточек/плашек контента без собственного
 * стекинг-контекста (запрос пользователя того же дня: "все анимации
 * эффектов должны быть под плашками", живой скриншот — волны поверх
 * "Тема"/"Размер текста"). "Под плашками" важнее, чем "видно при любом
 * Фон приложения" — возвращаем строго отрицательный z-index.
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
