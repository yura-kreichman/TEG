"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

// Крупная галочка, "улетающая" в центр экрана при успешном сохранении
// (запрос пользователя 2026-07-16) — дополняет, а не заменяет галочку на
// самой кнопке (SaveButton): та остаётся основным индикатором "именно эта
// форма сохранена", эта — заметный на весь экран акцент, что действие точно
// прошло. SaveButton сам сообщает координаты своего центра через кастомное
// событие "save-success-fly" (см. save-button.tsx) — здесь только приём и
// анимация, единственный монтаж на всё приложение (см. (app)/layout.tsx).
const SIZE = 40;
const FLY_MS = 450;
const HOLD_MS = 350;
const EXIT_MS = 250;

interface FlyEvent {
  id: number;
  x: number;
  y: number;
}

let nextId = 0;

export function SaveSuccessOverlay() {
  const [events, setEvents] = useState<FlyEvent[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (!detail) return;
      const id = ++nextId;
      setEvents((prev) => [...prev, { id, x: detail.x, y: detail.y }]);
      setTimeout(() => {
        setEvents((prev) => prev.filter((ev) => ev.id !== id));
      }, FLY_MS + HOLD_MS);
    }
    window.addEventListener("save-success-fly", handler);
    return () => window.removeEventListener("save-success-fly", handler);
  }, []);

  if (events.length === 0) return null;

  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  return (
    <div className="pointer-events-none fixed inset-0 z-100">
      <AnimatePresence>
        {events.map((ev) => (
          <motion.div
            key={ev.id}
            className="fixed top-0 left-0 grid place-items-center rounded-full bg-foreground text-background shadow-2xl"
            style={{ width: SIZE, height: SIZE }}
            initial={{ x: ev.x - SIZE / 2, y: ev.y - SIZE / 2, scale: 0.6, opacity: 1 }}
            animate={{
              x: centerX - SIZE / 2,
              y: centerY - SIZE / 2,
              scale: 1.7,
              transition: { duration: FLY_MS / 1000, ease: [0.16, 1, 0.3, 1] },
            }}
            exit={{ opacity: 0, scale: 1.4, transition: { duration: EXIT_MS / 1000 } }}
          >
            <Check className="size-5" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
