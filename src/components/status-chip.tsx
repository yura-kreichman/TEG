import { cn } from "@/lib/utils";

/**
 * Status chip per docs/design/prototype-owner-v2.html (.chip/.chip.warn):
 * accent-soft pill with a dot for positive/active statuses, warning-soft for
 * things needing attention (e.g. "Тарифы не заданы"). Not for destructive
 * states — those live in the kebab action sheet, not on the card itself.
 */
export function StatusChip({
  children,
  variant = "accent",
}: {
  children: React.ReactNode;
  variant?: "accent" | "warning" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        variant === "accent" && "bg-primary/10 text-primary",
        variant === "warning" && "bg-warning/15 text-warning",
        variant === "neutral" && "bg-muted text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          variant === "accent" && "bg-primary",
          variant === "warning" && "bg-warning",
          variant === "neutral" && "bg-muted-foreground/40"
        )}
      />
      {children}
    </span>
  );
}
