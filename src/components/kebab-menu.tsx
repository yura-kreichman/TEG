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
      className="size-8 shrink-0 rounded-lg border-border"
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
      className={cn("size-8 shrink-0 rounded-lg border-border", destructive && "text-destructive hover:text-destructive")}
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
  trailing,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  // Элемент справа (например, Switch) вместо стрелки/только для рядов,
  // которые переключают настройку, а не открывают следующий экран (запрос
  // пользователя 2026-07-28: "Печать квитанции" в кебабе зоны). Рендерится
  // ВНЕ <button>, чтобы клик по нему (свой интерактивный элемент) не
  // всплывал в onClick самой строки — но тем же <button> для текста, что и
  // у всех остальных пунктов, гарантированно с идентичным шрифтом (реальный
  // баг, найден пользователем 2026-07-28: отдельный <div>-ряд с теми же на
  // вид классами всё равно визуально отличался от соседних ActionSheetItem
  // по неясной причине — переиспользование самого компонента снимает вопрос
  // целиком, а не гадание, какого класса не хватает).
  trailing?: React.ReactNode;
}) {
  return (
    <div className={cn("flex w-full items-center border-t border-border first:border-t-0", trailing && "gap-3")}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex flex-1 items-center gap-3 py-3.5 text-left text-body-airbnb disabled:cursor-default disabled:text-muted-foreground/50",
          destructive ? "text-destructive" : "text-foreground"
        )}
      >
        <Icon className="size-4 shrink-0" />
        {children}
      </button>
      {trailing}
    </div>
  );
}
