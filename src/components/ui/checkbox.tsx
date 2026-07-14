"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Первый чекбокс в проекте (до этого — только Switch/Select на том же
// @base-ui/react). Крупный по умолчанию (docs/spec/07-instructions.md,
// "Макеты и вёрстка": "22px, скругление 7px") — согласие на публичной
// странице подписания должно быть заметным, не мелким системным чекбоксом.
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // border-input (#E8EBE8) практически сливается с surface-0 (#F6F7F5) —
        // для маленького 22px квадрата на светлом фоне этого недостаточно,
        // "вообще не видно" в живой проверке (нашёл пользователь). Ощутимо
        // темнее по foreground/тени, не хардкод-hex — токен, не отдельный цвет.
        "flex size-5.5 shrink-0 items-center justify-center rounded-[7px] border-2 border-foreground/25 bg-background shadow-[inset_0_1px_2px_rgba(0,0,0,.06)] transition-colors outline-none",
        // Небольшая "глубина" в отмеченном состоянии — тот же приём, что у
        // Switch (запрос пользователя 2026-07-14): градиент + inset-тень.
        "data-checked:border-primary data-checked:bg-linear-to-b data-checked:from-primary data-checked:to-[color-mix(in_oklch,var(--primary),black_14%)] data-checked:shadow-[inset_0_1px_2px_rgba(0,0,0,.2)]",
        "data-focus-visible:ring-3 data-focus-visible:ring-ring/50",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-primary-foreground">
        <Check className="size-4" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
