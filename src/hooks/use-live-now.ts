"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Живой "сейчас", обновляется через requestAnimationFrame (docs/spec/
 * 04-game-room.md, "живые таймеры от серверного started_at") — тот же приём,
 * что SweepButton (src/components/motion/SweepButton.tsx): значение всегда
 * пересчитывается от Date.now(), а не накапливается тиками, поэтому не
 * "доводить" после паузы нечего — просто новое значение сразу верное. rAF
 * останавливается на visibilitychange (не тратим батарею в фоновой вкладке) и
 * сразу даёт свежее значение при возврате.
 *
 * В отличие от SweepButton (декоративная заливка, которую reduced-motion
 * останавливает), здесь показывается функциональное время — reduced-motion
 * не должен замораживать сами цифры, только визуальную пульсацию истёкшего
 * пуска (это делается отдельно, CSS-классом, не здесь).
 */
export function useLiveNow(): Date {
  const [now, setNow] = useState(() => new Date());
  const rafRef = useRef<number | null>(null);
  // Инициализируется в start() при монтировании — Date.now() не должен
  // вызываться прямо в теле рендера/инициализаторе useRef (react-hooks/purity).
  const lastSecondRef = useRef<number>(0);

  useEffect(() => {
    function tick() {
      const second = Math.floor(Date.now() / 1000);
      if (second !== lastSecondRef.current) {
        lastSecondRef.current = second;
        setNow(new Date());
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    function start() {
      lastSecondRef.current = Math.floor(Date.now() / 1000);
      setNow(new Date());
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
  }, []);

  return now;
}
