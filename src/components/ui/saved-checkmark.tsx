"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFlyOnShow } from "@/hooks/use-fly-on-show";
import { checkPopAnimate, checkPopTransition } from "@/components/ui/check-pop-animation";

// Обратная связь "сохранено" вне кнопки (автосохранение по onChange, без
// отдельного клика) — та же анимация и то же "улетание" в центр экрана, что
// и у SaveButton (checkPopAnimate/useFlyOnShow, общие) — решение
// пользователя 2026-07-16: "интерфейс должен быть идентичен", раньше здесь
// была отдельная более простая CSS-анимация без вылета за 100% и без полёта
// в центр. Рендерится всегда (не условно) — scale-0 в состоянии "скрыто",
// иначе анимации не откуда стартовать.
export function SavedCheckmark({ show, className }: { show: boolean; className?: string }) {
  const anchorRef = useFlyOnShow<HTMLDivElement>(show, "save-success-fly");
  return (
    <motion.div
      ref={anchorRef}
      aria-hidden
      className={cn("mx-auto flex size-7 items-center justify-center rounded-full bg-success/15 text-success", className)}
      initial={false}
      animate={checkPopAnimate(show)}
      transition={checkPopTransition(show)}
    >
      <Check className="size-4" />
    </motion.div>
  );
}
