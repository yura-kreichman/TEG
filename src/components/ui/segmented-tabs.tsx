"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedTabOption<T extends string> {
  key: T;
  label: ReactNode;
}

// Единый таб-переключатель (вынесен из дублирующихся копий — Инструктажи,
// Лендинг, Отчёты точки, период Неделя/Месяц, фильтр статусов Задач — запрос
// пользователя 2026-07-14, "по идее это тот же контрол"). Небольшой "объём":
// неактивный таб слегка приподнят (внешняя тень + блик сверху, как у Button
// variant="outline"), активный — "вдавлен" (inset-тень вместо внешней), чтобы
// разница читалась не только акцентным цветом, но и формой.
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  equalWidth = true,
  shape = "pill",
  size = "md",
  className,
}: {
  options: readonly SegmentedTabOption<T>[];
  value: T;
  onChange: (key: T) => void;
  // false — таб-бар из многих коротких пунктов, оборачивается по ширине
  // (Отчёты точки); true — 2-3 таба на всю ширину, поровну (Инструктажи/Лендинг).
  equalWidth?: boolean;
  // "pill" — rounded-full (табы-разделы); "control" — rounded-control (период
  // Неделя/Месяц, фильтр статусов Задач) — та же логика активного/неактивного
  // состояния, просто другой радиус скругления по месту использования.
  shape?: "pill" | "control";
  // "sm" — компактнее (Отчёты точки: 4 таба-раздела, запрос пользователя
  // 2026-07-15 "написать немного мельче").
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={cn(
            "border font-semibold transition-shadow",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            shape === "pill" ? "rounded-full" : "rounded-control",
            equalWidth && "flex-1 text-center",
            value === option.key
              ? "border-primary bg-primary/10 text-primary shadow-[inset_0_1px_3px_rgba(0,0,0,.12)]"
              : "border-border bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,.05),inset_0_1px_0_rgba(255,255,255,.5)]"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
