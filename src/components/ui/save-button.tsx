"use client";

import * as React from "react";
import { Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Более выраженный "объёмный" bevel, чем у обычной кнопки variant="default"
// (референс — тот же UI kit mikedonovandesign.com, что и у Switch, решение
// пользователя 2026-07-14) — специально для кнопки "Сохранить" по всему
// проекту, не для кнопок вообще: акцент на главном действии формы/bottom
// sheet. Обратная связь об успехе — не смена текста на "Сохранено" (как
// было раньше в каждом месте по-своему), а галочка, которая быстро
// появляется справа с эффектом zoom и так же зумом исчезает — саму кнопку
// это больше не дёргает шириной/текстом. Логика "когда показывать" (флаг
// saved + auto-reset через 1500мс) остаётся на стороне вызывающей страницы,
// как и было — компонент только рендерит анимацию.
export interface SaveButtonProps extends Omit<React.ComponentProps<typeof Button>, "children"> {
  children: React.ReactNode;
  saved?: boolean;
}

function SaveButton({ children, saved, className, ...props }: SaveButtonProps) {
  return (
    <Button
      className={cn(
        "relative gap-1.5",
        "shadow-[0_3px_6px_rgba(0,0,0,.2),inset_0_1px_0_rgba(255,255,255,.22),inset_0_-2px_3px_rgba(0,0,0,.12)]",
        "hover:shadow-[0_4px_10px_rgba(0,0,0,.24),inset_0_1px_0_rgba(255,255,255,.25),inset_0_-2px_3px_rgba(0,0,0,.14)]",
        "active:shadow-[0_1px_2px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.16),inset_0_-1px_2px_rgba(0,0,0,.14)]",
        className
      )}
      {...props}
    >
      <Save className="size-4" />
      {children}
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center transition-transform duration-200 ease-out",
          saved ? "scale-100" : "scale-0"
        )}
      >
        <Check className="size-4" />
      </span>
    </Button>
  );
}

export { SaveButton };
