import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

// Плавно мигающий значок "смена сейчас открыта" — только для авто-режима
// (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА ВРЕМЕНИ"): в ручном режиме нет
// живого started_at на сервере, "открыта прямо сейчас" не имеет того же
// смысла. motion-safe: respects prefers-reduced-motion без отдельной логики.
export function OpenShiftBadge({ className }: { className?: string }) {
  return (
    <Play
      aria-hidden
      className={cn("absolute -right-0.5 -top-0.5 size-4 fill-success text-success motion-safe:animate-pulse", className)}
    />
  );
}
