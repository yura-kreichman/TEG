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
        "flex shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary",
        size === "lg" ? "size-[52px]" : "size-[46px]"
      )}
    >
      {iconKey ? (
        <AssetOrZoneIcon iconKey={iconKey} className={size === "lg" ? "size-6" : "size-5"} />
      ) : (
        <Fallback className={size === "lg" ? "size-6" : "size-5"} />
      )}
    </div>
  );
}
