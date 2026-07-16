"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// Крупный "взрыв" на месте удаления (запрос пользователя 2026-07-16: "как и
// галочка при сохранении, только иконка мусорки должна взрываться") —
// парный компонент к SaveSuccessOverlay, тот же приём (кнопка сама шлёт
// координаты своего центра событием, здесь только приём и анимация), но
// вместо полёта в центр экрана — разлёт осколков прямо в точке клика: акт
// удаления не "поднимается" на весь экран, а происходит именно там, где
// была кнопка. Единственный монтаж — (app)/layout.tsx.
const SHARD_COUNT = 10;
const LIFETIME_MS = 550;

interface ExplodeEvent {
  id: number;
  x: number;
  y: number;
}

const SHARDS = Array.from({ length: SHARD_COUNT }, (_, i) => {
  const angle = (i / SHARD_COUNT) * Math.PI * 2 + (i % 2 ? 0.25 : 0);
  const distance = 34 + (i % 3) * 10;
  return {
    dx: Math.cos(angle) * distance,
    dy: Math.sin(angle) * distance,
    rotate: (i % 2 ? 1 : -1) * (180 + i * 20),
  };
});

let nextId = 0;

export function DeleteSuccessOverlay() {
  const [events, setEvents] = useState<ExplodeEvent[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (!detail) return;
      const id = ++nextId;
      setEvents((prev) => [...prev, { id, x: detail.x, y: detail.y }]);
      setTimeout(() => {
        setEvents((prev) => prev.filter((ev) => ev.id !== id));
      }, LIFETIME_MS);
    }
    window.addEventListener("delete-success-explode", handler);
    return () => window.removeEventListener("delete-success-explode", handler);
  }, []);

  if (events.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-100">
      <AnimatePresence>
        {events.map((ev) => (
          <motion.div key={ev.id} className="fixed top-0 left-0" style={{ x: ev.x, y: ev.y }}>
            {SHARDS.map((s, i) => (
              <motion.span
                key={i}
                className="absolute top-0 left-0 size-1.5 rounded-[1.5px] bg-destructive"
                initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
                animate={{ x: s.dx, y: s.dy, opacity: 0, scale: 0.3, rotate: s.rotate }}
                exit={{ opacity: 0 }}
                transition={{ duration: LIFETIME_MS / 1000, ease: "easeOut" }}
              />
            ))}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
