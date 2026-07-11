import { MapPin, type LucideIcon } from "lucide-react";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { cn } from "@/lib/utils";

/**
 * Square icon tile per docs/design/prototype-owner-v2.html (.tile-icon):
 * accent-soft background, rounded-control corners, falls back to a generic
 * icon when the entity has no chosen iconKey yet.
 *
 * emoji — Zone.telegramEmoji (фидбек пользователя 2026-07-12: "нужно, чтобы
 * emodji для зон отображались, как цветовая метка") — тот же приём, что
 * цветной кружок-метка оператора в /operators (absolute -bottom/-right поверх
 * иконки), только крупнее и с самим эмодзи вместо сплошного цвета, иначе
 * маленький эмодзи-символ было бы не разобрать.
 */
export function TileIcon({
  iconKey,
  emoji,
  fallback: Fallback = MapPin,
  size = "default",
}: {
  iconKey: string | null | undefined;
  emoji?: string | null;
  fallback?: LucideIcon;
  size?: "default" | "lg";
}) {
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          "flex items-center justify-center rounded-control bg-linear-to-br from-primary/15 to-primary/6 text-primary shadow-[0_2px_6px_rgba(0,0,0,.08)]",
          size === "lg" ? "size-[52px]" : "size-[46px]"
        )}
      >
        {iconKey ? (
          <AssetOrZoneIcon iconKey={iconKey} className={size === "lg" ? "size-8" : "size-7"} />
        ) : (
          <Fallback className={size === "lg" ? "size-8" : "size-7"} />
        )}
      </div>
      {emoji && (
        <span
          className={cn(
            "absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-card text-center leading-none ring-2 ring-card",
            size === "lg" ? "size-6 text-[15px]" : "size-5 text-[13px]"
          )}
        >
          {emoji}
        </span>
      )}
    </div>
  );
}
