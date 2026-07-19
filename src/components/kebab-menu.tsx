"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Per docs/design/prototype-owner-v2.html: entity actions (rename, delete,
 * change PIN, etc.) live behind a round "···" button, never as inline text
 * links on the card itself. Pair with BottomSheet + ActionSheetItem —
 * see /points, /operators, /zones/[id] for the pattern (kebab opens a sheet
 * whose content the page swaps between an action list / rename form /
 * delete-confirmation view via its own local state).
 */
export function KebabButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-8 shrink-0 rounded-full border-border"
      onClick={onClick}
      aria-label={label}
    >
      <MoreHorizontal className="size-4" />
    </Button>
  );
}

/**
 * Отдельная кнопка-иконка для ОДНОГО действия (запрос пользователя
 * 2026-07-19: "вместо кнопки кебаб должна быть иконка мусорки, ведь у нас
 * одно действие только удаления" / "эти иконки надо сделать похожими на
 * кнопки, как и сама кнопка 'Категории'") — та же outline-кнопка-кружок,
 * что KebabButton выше, просто с произвольной иконкой и прямым действием
 * без промежуточного меню. Используется, когда действий 1-2 и оборачивать
 * их в BottomSheet-меню избыточно (одно действие) или сами кнопки уже
 * видны рядом (два действия, как "Изменить"/"Удалить" у истории сдач).
 */
export function IconActionButton({
  icon: Icon,
  onClick,
  label,
  destructive = false,
}: {
  icon: LucideIcon;
  onClick: () => void;
  label: string;
  destructive?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("size-8 shrink-0 rounded-full border-border", destructive && "text-destructive hover:text-destructive")}
      onClick={onClick}
      aria-label={label}
    >
      <Icon className="size-4" />
    </Button>
  );
}

export function ActionSheetItem({
  icon: Icon,
  children,
  onClick,
  destructive = false,
  disabled = false,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 border-t border-border py-3.5 text-left text-body-airbnb first:border-t-0 disabled:cursor-default disabled:text-muted-foreground/50",
        destructive ? "text-destructive" : "text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {children}
    </button>
  );
}
