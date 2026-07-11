"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface SweepButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * CSS-цвет пройденного сектора. По умолчанию — самый светлый тон текущей
   * акцентной схемы тенанта (та же формула, что и в свотчах на экране
   * "Внешний вид", src/components/accent-picker.tsx), не нейтральный серый —
   * по фидбеку пользователя 2026-07-11.
   */
  fillColor?: string;
  /** Секунд на полный оборот заливки. По умолчанию 60 (секундная стрелка). */
  period?: number;
}

function computeAngle(period: number) {
  const periodMs = period * 1000;
  return ((Date.now() % periodMs) / periodMs) * 360;
}

/**
 * Кнопка с фоном-секундомером (docs/spec/05-work-time.md, доп. к Step 4
 * 2026-07-11, кнопка "Закончить смену") — секторная conic-gradient заливка,
 * угол = прошедшие секунды текущего периода. Синхронизирована с Date.now(),
 * не с моментом монтирования — при возврате из фона/на другом устройстве
 * угол сразу верный, без дрейфа. requestAnimationFrame останавливается на
 * visibilitychange (вкладка скрыта — не тратим батарею впустую), возобновляется
 * при возврате — пересчитывать нечего, каждый кадр и так берёт Date.now() заново.
 * prefers-reduced-motion: заливка не анимируется (один статичный угол на монтировании).
 */
export function SweepButton({
  children,
  className,
  onClick,
  disabled,
  fillColor = "color-mix(in oklch, var(--primary), white 45%)",
  period = 60,
}: SweepButtonProps) {
  const [angle, setAngle] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function tick() {
      setAngle(computeAngle(period));
      rafRef.current = requestAnimationFrame(tick);
    }

    function start() {
      if (reduceMotion) {
        setAngle(computeAngle(period));
        return;
      }
      if (rafRef.current === null) tick();
    }

    function stop() {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    function handleVisibility() {
      if (document.hidden) stop();
      else start();
    }

    start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [period]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn("relative overflow-hidden rounded-control border-[1.5px] border-primary", className)}
      style={{ background: `conic-gradient(${fillColor} ${angle}deg, var(--background) ${angle}deg 360deg)` }}
    >
      {/* Контент поверх заливки — контраст не должен зависеть от положения
          сектора. Заливка светлая (акцентный тон), непройденная часть кнопки
          тёмная (var(--background)) — единого цвета текста, читаемого на
          обеих, не существует, поэтому контент сидит на собственной пилюле
          цвета фона кнопки: сливается с непройденной частью, читаемой
          подложкой ложится поверх пройденной. */}
      <span className="relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-control bg-background/85 px-2 py-1">
        {children}
      </span>
    </button>
  );
}
