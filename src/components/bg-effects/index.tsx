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
 * z-index: 1, не отрицательный — реальный баг, найден пользователем
 * 2026-07-27 (живой тест на планшете): отрицательный z-index прятался за
 * bg-surface-0 (полотно страницы), которое полностью непрозрачно на любом
 * устройстве, где в Настройки → Внешний вид → "Фон приложения" не выбран
 * узор — не связанная с этим эффектом настройка, но эффект молча гас
 * из-за неё. .nav-glass получил явный z-index: 10 (globals.css) именно
 * чтобы остаться выше — без этого при z-index: 1 здесь бар и декоративный
 * слой были бы на одном уровне (оба z-index: auto по умолчанию), порядок
 * между ними не гарантирован.
 */
export function BgEffectLayer({ effect }: { effect: BgEffect }) {
  if (effect === "none") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 h-32 overflow-hidden" style={{ zIndex: 1 }}>
      {effect === "waves" && <WavesEffect />}
      {effect === "particles" && <ParticlesEffect />}
      {effect === "sparkles" && <SparklesEffect />}
      {effect === "aurora" && <AuroraEffect />}
      {effect === "shimmer" && <ShimmerEffect />}
    </div>
  );
}
