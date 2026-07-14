"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";
import { PressableScale } from "@/components/motion/pressable-scale";

// Экспериментальный вариант переключателя — тест ТОЛЬКО на странице
// "Сводки с итогами" (решение пользователя 2026-07-14, референс —
// mikedonovandesign.com UI kit: объёмный трек + бегунок с бликом, БЕЗ
// подписей ON/OFF, акцентный цвет вместо фиксированного). Не заменяет
// src/components/ui/switch.tsx — тот используется везде по проекту без
// изменений, пока тест не подтверждён. Если понравится — перенести этот
// стиль туда, а не плодить два компонента навсегда.
//
// "Объём" — тот же приём, что у Button variant="default" (лёгкий градиент
// + тень внутри акцентного цвета, src/components/ui/button.tsx, фидбек
// пользователя 2026-07-09), применённый к треку и бегунку тумблера:
// у трека — inset-тень (утопленный жёлоб) и акцентный градиент во
// включённом состоянии; у бегунка — градиент + блик сверху + лёгкая тень
// снизу изнутри, поверх обычной внешней тени. Работает в обеих темах —
// цвета через var(--primary)/bg-muted, не хардкод.
function SwitchDepth({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <PressableScale className="inline-flex">
      <SwitchPrimitive.Root
        data-slot="switch"
        className={cn(
          "inline-flex h-7 w-11.5 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors",
          "bg-muted shadow-[inset_0_1px_3px_rgba(0,0,0,.18)]",
          "data-checked:bg-linear-to-b data-checked:from-primary data-checked:to-[color-mix(in_oklch,var(--primary),black_14%)]",
          "data-checked:shadow-[inset_0_1px_3px_rgba(0,0,0,.28)]",
          "data-disabled:pointer-events-none data-disabled:opacity-50",
          className
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            "block size-5.5 rounded-full transition-transform duration-200 data-checked:translate-x-5",
            "bg-linear-to-b from-white to-[color-mix(in_oklch,white,black_6%)]",
            "shadow-[0_1px_3px_rgba(0,0,0,.3),inset_0_1px_1px_rgba(255,255,255,.7),inset_0_-1px_1px_rgba(0,0,0,.08)]"
          )}
        />
      </SwitchPrimitive.Root>
    </PressableScale>
  );
}

export { SwitchDepth };
