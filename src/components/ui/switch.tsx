"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";
import { PressableScale } from "@/components/motion/pressable-scale";

// Прототип docs/design/prototype-telegram-summaries-v1.html, .toggle:
// пилюля 46×28, серый фон выкл / акцент вкл, кружок-бегунок с тенью.
// Первый Switch в проекте — до этого тумблеров не было (только select.tsx
// на том же @base-ui/react).
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <PressableScale className="inline-flex">
      <SwitchPrimitive.Root
        data-slot="switch"
        className={cn(
          "inline-flex h-7 w-11.5 shrink-0 items-center rounded-full bg-muted p-0.5 transition-colors outline-none",
          "data-checked:bg-primary",
          "data-disabled:pointer-events-none data-disabled:opacity-50",
          className
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="block size-5.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-transform duration-200 data-checked:translate-x-5"
        />
      </SwitchPrimitive.Root>
    </PressableScale>
  );
}

export { Switch };
