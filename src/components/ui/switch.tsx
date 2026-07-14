"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";
import { PressableScale } from "@/components/motion/pressable-scale";

// Прототип docs/design/prototype-telegram-summaries-v1.html, .toggle —
// пилюля 46×28, серый фон выкл / акцент вкл. "Объёмный" стиль (референс —
// mikedonovandesign.com UI kit, решение пользователя 2026-07-14): у трека —
// inset-тень (утопленный жёлоб) и акцентный градиент во включённом
// состоянии; у бегунка — градиент + блик сверху + лёгкая тень снизу изнутри,
// поверх обычной внешней тени. Тот же приём объёма, что у Button
// variant="default" (src/components/ui/button.tsx, фидбек 2026-07-09).
// Обкатано сначала только на "Сводки с итогами" (2026-07-14), затем
// подтверждено и перенесено сюда как единственный Switch проекта.
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
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

export { Switch };
