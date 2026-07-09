import { MapPin, type LucideIcon } from "lucide-react";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { cn } from "@/lib/utils";

/**
 * Square icon tile per docs/design/prototype-owner-v2.html (.tile-icon):
 * accent-soft background, rounded-control corners, falls back to a generic
 * icon when the entity has no chosen iconKey yet.
 */
export function TileIcon({
  iconKey,
  fallback: Fallback = MapPin,
  size = "default",
}: {
  iconKey: string | null | undefined;
  fallback?: LucideIcon;
  size?: "default" | "lg";
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-control bg-linear-to-br from-primary/15 to-primary/6 text-primary shadow-[0_2px_6px_rgba(0,0,0,.08)]",
        size === "lg" ? "size-[52px]" : "size-[46px]"
      )}
    >
      {iconKey ? (
        <AssetOrZoneIcon iconKey={iconKey} className={size === "lg" ? "size-8" : "size-7"} />
      ) : (
        <Fallback className={size === "lg" ? "size-8" : "size-7"} />
      )}
    </div>
  );
}
