"use client";

import { SquareCheckBig, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { cn } from "@/lib/utils";

/**
 * Иконка вместо текстовой плашки "Активен"/"Активна"/"Неактивен" по всему
 * проекту (запрос пользователя 2026-07-22: "абсолютно везде... заменить на
 * зелёную иконку square-check-big... если неактивно... иконка серая
 * triangle-alert") — тот же принцип, что уже был у Устройств (Точки →
 * Устройства: активация без отдельного слова), теперь распространён на
 * Сотрудников, Точки, Зоны и сами Устройства (иконка активного устройства
 * была circle-check-big — заменена на square-check-big для единообразия;
 * добавлено серое предупреждение для неактивированных — раньше при
 * неактивном устройстве не показывалось вообще ничего).
 *
 * Кликабельная, в стиле обычных "белых кнопок" проекта (запрос пользователя
 * того же дня: "чтобы при клике можно было активировать либо
 * деактивировать" + "кнопка в стиле наших обычных белых кнопок") — тот же
 * Button variant="outline" size="icon", что уже использует
 * IconActionButton (kebab-menu.tsx) для похожих круглых иконок-кнопок,
 * просто с динамическими иконкой/цветом вместо статичных. `onToggle`
 * опционален — там, где сейчас нет под рукой готового обработчика, не
 * передаётся, и иконка остаётся некликабельным индикатором (обычный текст
 * вместо кнопки).
 */
export function ActiveStatusIcon({
  active,
  activeLabel,
  inactiveLabel,
  onToggle,
  className,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onToggle?: () => void;
  className?: string;
}) {
  const label = active ? activeLabel : inactiveLabel;
  const Icon = active ? SquareCheckBig : TriangleAlert;

  if (!onToggle) {
    return (
      <span className={cn("flex size-8 shrink-0 items-center justify-center", className)}>
        <Icon className={cn("size-4", active ? "text-success" : "text-muted-foreground")}>
          <title>{label}</title>
        </Icon>
      </span>
    );
  }

  return (
    <PressableScale className="shrink-0">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        aria-label={label}
        className={cn("size-8 shrink-0 rounded-full border-border", active ? "text-success" : "text-muted-foreground", className)}
      >
        <Icon className="size-4" />
      </Button>
    </PressableScale>
  );
}
