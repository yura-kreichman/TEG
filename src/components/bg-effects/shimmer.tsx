import { ACCENT_LAYER_OPACITIES, TOP_FADE_MASK } from "./shared";

// "Диагональный блик" (запрос пользователя 2026-07-27) — светлые полосы
// акцентного цвета периодически проходят по диагонали. Только transform
// (см. .shimmer-layer/@keyframes shimmer-sweep в globals.css) — opacity не
// анимируется, задаётся статично инлайн-стилем.
//
// Реальный баг, найден пользователем 2026-07-27: "Блик прерывается, не
// выглядит цикличным" — двух версий подряд (сначала -30%/130%, потом
// расчёт "своего" % на полосу через translateX(%), который считается от
// СОБСТВЕННОЙ ширины элемента). Настоящая причина глубже: перевод в
// translateX(%) с точки зрения "% от чего" ненадёжен сразу в двух местах
// (свотч превью в разы уже реального фона, а сама полоса у́же контейнера) —
// собрать формулу, верную для любого сочетания размеров, не выйдет.
// Правильное решение — анимировать НЕ саму цветную полосу, а обёртку
// шириной РОВНО с контейнер (inset-0, т.е. её собственная ширина всегда ==
// ширине контейнера, каким бы он ни был — свотч 150px или весь экран).
// translateX(-100%)/translateX(100%) для ТАКОЙ обёртки математически точно
// уводит её (и всё, что внутри) ровно на одну ширину контейнера в сторону —
// гарантированно за край, в любом контейнере, независимо от ширины
// собственно цветной полосы внутри.
const BANDS = [
  { opacity: ACCENT_LAYER_OPACITIES[0], left: "10%", width: "40%", duration: "9s", delay: "0s" },
  { opacity: ACCENT_LAYER_OPACITIES[1], left: "30%", width: "26%", duration: "6.5s", delay: "1.5s" },
  { opacity: ACCENT_LAYER_OPACITIES[2], left: "45%", width: "16%", duration: "4.5s", delay: "0.7s" },
] as const;

export function ShimmerEffect() {
  return (
    <div
      className="absolute inset-0"
      style={{ maskImage: TOP_FADE_MASK, WebkitMaskImage: TOP_FADE_MASK }}
    >
      {BANDS.map((band, i) => (
        <div
          key={i}
          className="shimmer-layer absolute inset-0"
          style={{ animationDuration: band.duration, animationDelay: band.delay }}
        >
          <span
            className="absolute inset-y-0 skew-x-[-20deg]"
            style={{
              left: band.left,
              width: band.width,
              background: "linear-gradient(90deg, transparent, var(--color-primary), transparent)",
              opacity: band.opacity,
            }}
          />
        </div>
      ))}
    </div>
  );
}
