"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { playSaveDing, unlockBeep } from "@/lib/beep";

// Крупная галочка, "улетающая" в центр экрана при успешном сохранении
// (запрос пользователя 2026-07-16) — дополняет, а не заменяет галочку на
// самой кнопке (SaveButton): та остаётся основным индикатором "именно эта
// форма сохранена", эта — заметный на весь экран акцент, что действие точно
// прошло. SaveButton сам сообщает координаты своего центра через кастомное
// событие "save-success-fly" (см. save-button.tsx) — здесь только приём и
// анимация, единственный монтаж на всё приложение (см. (app)/layout.tsx).
//
// Три фазы (решение пользователя 2026-07-16: "не просто вылетать в центр, а
// становиться зелёной, и только потом при zoom-in исчезать"):
// 1) flying — летит от кнопки к центру, цвет нейтральный (bg-foreground);
// 2) green — уже в центре, цвет переключается на success (CSS-переход, не
//    трогает framer-motion — интерполировать CSS-переменные темы через
//    framer-motion ненадёжно, обычный transition-colors работает всегда);
// 3) zoomOut — растёт и тает, зелёная.
const SIZE = 40;
const FLY_MS = 450;
const GREEN_HOLD_MS = 300;
const ZOOM_OUT_MS = 300;
const TOTAL_MS = FLY_MS + GREEN_HOLD_MS + ZOOM_OUT_MS;

type Phase = "flying" | "green" | "zoomOut";

interface FlyEvent {
  id: number;
  x: number;
  y: number;
  phase: Phase;
}

let nextId = 0;

export function SaveSuccessOverlay() {
  const [events, setEvents] = useState<FlyEvent[]>([]);

  // Разблокировка AudioContext по самому первому тапу где угодно в
  // приложении (запрос пользователя 2026-07-20: звук "дзинь" нужен на ~40
  // экранах с SaveButton, у большинства из них своей ранней разблокировки
  // по тапу нет — раньше это делали только Пуски/Прибывания локально, у
  // себя на странице). SaveSuccessOverlay смонтирован один раз на всё
  // приложение — естественное место для общей разблокировки.
  useEffect(() => {
    document.addEventListener("pointerdown", unlockBeep, { once: true });
    return () => document.removeEventListener("pointerdown", unlockBeep);
  }, []);

  useEffect(() => {
    function setPhase(id: number, phase: Phase) {
      setEvents((prev) => prev.map((ev) => (ev.id === id ? { ...ev, phase } : ev)));
    }

    function handler(e: Event) {
      const detail = (e as CustomEvent<{ x: number; y: number; silent?: boolean }>).detail;
      if (!detail) return;
      // Звук "дзинь" при каждом сохранении (запрос пользователя 2026-07-20:
      // "везде... вылетает зелёная галочка") — кроме мест, что явно
      // помечают событие silent (ConfirmButton — у него в части экранов уже
      // свой отдельный звук подтверждения, playConfirmChime/playCloseChime,
      // два звука подряд на одно действие звучали бы как накладка).
      if (!detail.silent) playSaveDing();
      const id = ++nextId;
      setEvents((prev) => [...prev, { id, x: detail.x, y: detail.y, phase: "flying" }]);
      setTimeout(() => setPhase(id, "green"), FLY_MS);
      setTimeout(() => setPhase(id, "zoomOut"), FLY_MS + GREEN_HOLD_MS);
      setTimeout(() => {
        setEvents((prev) => prev.filter((ev) => ev.id !== id));
      }, TOTAL_MS);
    }
    window.addEventListener("save-success-fly", handler);
    return () => window.removeEventListener("save-success-fly", handler);
  }, []);

  if (events.length === 0) return null;

  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  return (
    <div className="pointer-events-none fixed inset-0 z-100">
      {events.map((ev) => (
        <motion.div
          key={ev.id}
          className={cn(
            "fixed top-0 left-0 grid place-items-center rounded-full shadow-2xl transition-colors duration-200",
            ev.phase === "flying" ? "bg-foreground text-background" : "bg-success text-success-foreground"
          )}
          style={{ width: SIZE, height: SIZE }}
          initial={{ x: ev.x - SIZE / 2, y: ev.y - SIZE / 2, scale: 0.6, opacity: 1 }}
          animate={
            ev.phase === "zoomOut"
              ? { scale: 1.9, opacity: 0, transition: { duration: ZOOM_OUT_MS / 1000, ease: "easeIn" } }
              : {
                  x: centerX - SIZE / 2,
                  y: centerY - SIZE / 2,
                  scale: 1.3,
                  transition: { duration: FLY_MS / 1000, ease: [0.16, 1, 0.3, 1] },
                }
          }
        >
          <Check className="size-5" />
        </motion.div>
      ))}
    </div>
  );
}
