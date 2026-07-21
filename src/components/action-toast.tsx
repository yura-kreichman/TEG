"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Zoom-in+bounce поверх экрана, автоматически гаснет fade-out+zoom-out
 * (запрос пользователя 2026-07-22: "сообщение по типу, как у Сотрудника
 * если не найден заказ") — та же анимация, что flashSearchError в
 * operator/tickets/page.tsx, но fixed относительно вьюпорта (не absolute
 * относительно ближайшего relative-родителя) — здесь сообщение реагирует
 * на тап по иконке статуса в ЛЮБОЙ строке списка (Точки/Зоны/Активы), а не
 * на один конкретный виджет фиксированного размера, как циферблат билетов.
 * Показ/скрытие и таймер — на стороне вызывающего компонента, см.
 * useActionToast (src/hooks/use-action-toast.ts).
 */
export function ActionToast({ message, variant = "success" }: { message: string | null; variant?: "success" | "error" }) {
  const Icon = variant === "success" ? Check : TriangleAlert;
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key="action-toast"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{
            scale: { type: "spring", stiffness: 500, damping: 14 },
            opacity: { duration: 0.15 },
          }}
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-6"
        >
          <div
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-card px-5 py-3 text-center text-white shadow-floating",
              variant === "success" ? "bg-success" : "bg-destructive"
            )}
          >
            <Icon className="size-9" />
            <span className="text-lg font-extrabold">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
