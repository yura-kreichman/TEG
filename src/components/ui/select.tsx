"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { PressableScale } from "@/components/motion/pressable-scale";

function Select<Value, Multiple extends boolean | undefined = false>(
  props: React.ComponentProps<typeof SelectPrimitive.Root<Value, Multiple>>
) {
  return <SelectPrimitive.Root {...props} />;
}

// Wrapped in PressableScale (same tap-feedback the rest of the app uses for
// every button) so the trigger feels tactile — every select in this app
// should have this, not opt-in per call site, so it lives here rather than
// being left to each caller to remember.
function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <PressableScale>
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        className={cn(
          "flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-control border border-input bg-background px-3 text-body-airbnb outline-none transition-colors",
          // Небольшая "глубина" (запрос пользователя 2026-07-14, тот же приём,
          // что у Switch/Button) — лёгкая внешняя тень + блик сверху, глубже
          // при открытом попапе, будто утоплен под нажатием.
          "shadow-[0_1px_2px_rgba(0,0,0,.05),inset_0_1px_0_rgba(255,255,255,.5)]",
          "data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/50 data-popup-open:shadow-[inset_0_1px_3px_rgba(0,0,0,.08)]",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        <SelectPrimitive.Icon className="flex shrink-0 items-center text-muted-foreground">
          <ChevronDown className="size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
    </PressableScale>
  );
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" className="min-w-0 truncate text-left" {...props} />;
}

function SelectContent({
  className,
  children,
  align = "start",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & {
  align?: React.ComponentProps<typeof SelectPrimitive.Positioner>["align"];
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner className="z-70 outline-none" sideOffset={6} align={align}>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-[min(60vh,320px)] w-(--anchor-width) min-w-(--anchor-width) overflow-y-auto rounded-control border border-border bg-card p-1 shadow-floating",
            "origin-(--transform-origin) transition-[transform,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-control px-3 py-2.5 text-body-airbnb outline-none select-none transition-colors",
        "data-highlighted:bg-muted active:bg-muted",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 truncate">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="flex shrink-0 items-center text-primary">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
