"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";
import { useFlyOnShow } from "@/hooks/use-fly-on-show";

// Финальная кнопка подтверждения удаления (второй шаг "переспроса", см.
// h-12 по всему проекту, запрос пользователя 2026-07-16) — парная к
// SaveButton: та же идея (иконка сама отыгрывает результат действия), но
// вместо галочки, вылетающей вперёд, иконка мусорки разлетается на осколки
// на месте — и локально на кнопке, и увеличенно в этой же точке экрана
// (DeleteSuccessOverlay, слушает "delete-success-explode", смонтирован один
// раз в (app)/layout.tsx). Текст по умолчанию — t.common.delete, как у
// SaveButton — children нужен только в редких исключениях.
const SHARD_COUNT = 6;
const SHARDS = Array.from({ length: SHARD_COUNT }, (_, i) => {
  const angle = (i / SHARD_COUNT) * Math.PI * 2;
  return {
    dx: Math.cos(angle) * 14,
    dy: Math.sin(angle) * 14,
    rotate: (i % 2 ? 1 : -1) * 200,
  };
});

export interface DeleteButtonProps extends Omit<React.ComponentProps<typeof Button>, "children"> {
  children?: React.ReactNode;
  deleted?: boolean;
}

function DeleteButton({ children, deleted, className, ...props }: DeleteButtonProps) {
  const t = useI18n();
  const anchorRef = useFlyOnShow<HTMLSpanElement>(!!deleted, "delete-success-explode");

  return (
    <Button variant="destructive" className={cn("relative gap-1.5", className)} {...props}>
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute inset-0" />
      <span className="relative grid size-4 shrink-0 place-items-center">
        <motion.span
          className="grid place-items-center"
          animate={{ scale: deleted ? 0 : 1, opacity: deleted ? 0 : 1 }}
          transition={{ duration: 0.15 }}
        >
          <Trash2 className="size-4" />
        </motion.span>
        {deleted &&
          SHARDS.map((s, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-current"
              initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
              animate={{ x: s.dx, y: s.dy, opacity: 0, scale: 0.3, rotate: s.rotate }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            />
          ))}
      </span>
      {children ?? t.common.delete}
    </Button>
  );
}

export { DeleteButton };
