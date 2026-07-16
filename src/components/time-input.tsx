"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Единая точка входа для полей времени type="time" (запрос пользователя
// 2026-07-16: "везде по всему проекту сделай часики в таком же стиле, как и
// символ валюты") — тот же приём, что у MoneyInput: значок в квадратной
// кнопке на лёгком сером фоне справа, не голая нативная иконка браузера
// (та выглядела нестильно и непоследовательно рядом с денежными полями).
// Нативный ::-webkit-calendar-picker-indicator остаётся на месте и рабочим
// (открывает системный пикер по клику), просто становится невидимым —
// сверху лежит наш значок, но не перехватывает клик (pointer-events-none),
// поэтому клик по нему всё равно долетает до нативного индикатора под ним.
export function TimeInput({
  className,
  scale,
  ...props
}: React.ComponentProps<typeof Input> & { scale?: "lg" }) {
  return (
    <div className="relative">
      <Input
        type="time"
        {...props}
        className={cn(
          "text-center tabular-nums [&::-webkit-calendar-picker-indicator]:opacity-0",
          scale === "lg" ? "pr-14" : "pr-11",
          className
        )}
      />
      <span
        className={cn(
          "pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center justify-center rounded-control border border-border bg-muted text-muted-foreground",
          scale === "lg" ? "size-10" : "size-8"
        )}
      >
        <Clock className={scale === "lg" ? "size-5" : "size-4"} />
      </span>
    </div>
  );
}
