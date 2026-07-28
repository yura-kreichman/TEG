import type { CSSProperties } from "react";

// Собственная, более яркая шкала прозрачности — не общая ACCENT_LAYER_OPACITIES
// (запрос пользователя 2026-07-28: "мало звёзд и они очень тусклые") —
// точки здесь 2-3px, в разы мельче площадью, чем волна/пятно свечения у
// остальных эффектов, той же прозрачности им физически не хватает, чтобы
// читаться на глаз. Не трогаем общую константу — она разделяется с
// Волнами/Частицами/Свечением/Бликом, только у звёзд свой масштаб.
const HYPERSPACE_OPACITIES = [0.35, 0.55, 0.8] as const;

// "Гиперпространство" (запрос пользователя 2026-07-28: "классическое
// звёздное небо как в старых Windows", заменяет удалённый эффект "Искры") —
// тот же принцип, что у остальных эффектов: фиксированный набор точек,
// ноль JS в рендер-цикле (обсуждали canvas+rAF, как в исходном промте
// пользователя — отклонено, здесь эффекты принципиально CSS-only, заводить
// canvas ради одного эффекта не стали). Каждая "звезда" летит по прямой от
// нижнего центра контейнера (точка схода) наружу и вверх, одновременно
// вырастая (scale) — имитация полёта сквозь звёзды без единой строчки
// покадровой математики: вся траектория — CSS-переменные на конечную точку
// в @keyframes (см. .hyperspace-layer в globals.css).
// dx/dy — % конечной точки (left/bottom), НЕ transform: translate() —
// реальный баг, найден пользователем 2026-07-28: этот же компонент рендерит
// и настоящий фон (h-32 на всю ширину экрана), и крошечное превью в
// настройках (h-9 в узкой колонке пикера) — абсолютные rem/px вылетали за
// пределы 36px-превью почти мгновенно (звёзды были там не видны вовсе), а
// transform: translate(%) считается от размера САМОЙ звезды (2-3px), не
// контейнера. left/bottom в % — то немногое, что одинаково пропорционально
// работает в обоих масштабах (см. @keyframes hyperspace-fly в globals.css).
const STARS = [
  { opacity: HYPERSPACE_OPACITIES[0], dx: "22%", dy: "92%", size: 3, duration: "5.5s", delay: "0s" },
  { opacity: HYPERSPACE_OPACITIES[0], dx: "78%", dy: "90%", size: 3, duration: "6.2s", delay: "1.4s" },
  { opacity: HYPERSPACE_OPACITIES[1], dx: "12%", dy: "70%", size: 2, duration: "4.6s", delay: "0.5s" },
  { opacity: HYPERSPACE_OPACITIES[1], dx: "88%", dy: "68%", size: 2, duration: "5s", delay: "2.2s" },
  { opacity: HYPERSPACE_OPACITIES[2], dx: "42%", dy: "96%", size: 2, duration: "4s", delay: "0.9s" },
  { opacity: HYPERSPACE_OPACITIES[2], dx: "58%", dy: "95%", size: 2, duration: "4.3s", delay: "1.9s" },
  { opacity: HYPERSPACE_OPACITIES[0], dx: "46%", dy: "80%", size: 3, duration: "5.8s", delay: "2.8s" },
  { opacity: HYPERSPACE_OPACITIES[1], dx: "54%", dy: "78%", size: 2, duration: "5.1s", delay: "0.2s" },
  { opacity: HYPERSPACE_OPACITIES[2], dx: "2%", dy: "50%", size: 2, duration: "3.6s", delay: "1.1s" },
  { opacity: HYPERSPACE_OPACITIES[2], dx: "98%", dy: "48%", size: 2, duration: "3.8s", delay: "3.1s" },
  { opacity: HYPERSPACE_OPACITIES[1], dx: "32%", dy: "60%", size: 2, duration: "4.9s", delay: "3.6s" },
  { opacity: HYPERSPACE_OPACITIES[1], dx: "68%", dy: "58%", size: 2, duration: "5.3s", delay: "0.7s" },
  { opacity: HYPERSPACE_OPACITIES[0], dx: "18%", dy: "40%", size: 3, duration: "4.2s", delay: "1.7s" },
  { opacity: HYPERSPACE_OPACITIES[0], dx: "82%", dy: "38%", size: 3, duration: "4.7s", delay: "2.5s" },
] as const;

export function HyperspaceEffect() {
  return (
    <>
      {STARS.map((s, i) => (
        <span
          key={i}
          className="hyperspace-layer absolute rounded-full"
          style={
            {
              left: "50%",
              bottom: "0%",
              width: s.size,
              height: s.size,
              backgroundColor: "var(--color-primary)",
              "--peak-opacity": s.opacity,
              "--dx": s.dx,
              "--dy": s.dy,
              animationDuration: s.duration,
              animationDelay: s.delay,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}
