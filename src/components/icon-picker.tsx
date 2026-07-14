"use client";

import { useEffect, useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { ICON_FAMILIES, GENERAL_ICON_FAMILIES, type IconFamily } from "@/lib/icon-families";
import { cn } from "@/lib/utils";

const FAMILY_SEPARATOR = ":";

function parseIconKey(iconKey: string | null | undefined): { family: IconFamily; name: string } | null {
  if (!iconKey) return null;
  const sep = iconKey.indexOf(FAMILY_SEPARATOR);
  if (sep === -1) return null;
  const family = iconKey.slice(0, sep);
  const name = iconKey.slice(sep + 1);
  if (!(ICON_FAMILIES as readonly string[]).includes(family) || !name) return null;
  return { family: family as IconFamily, name };
}

function iconSrc(family: IconFamily, name: string) {
  return `/api/icon-library/${family}/${name}.svg`;
}

// Material-иконки в коллекции — залитые "fill=#FFFFFF" одноцветные силуэты
// (белые на прозрачном), в отличие от Fluent (градиенты/несколько цветов —
// см. public/icon-library/fluent/fluent-color--*.svg). <img src> не подхватывает
// currentColor из внешнего SVG-документа, поэтому для Material рендерим
// через CSS mask-image + bg-current — сам SVG остаётся исходным файлом,
// только его альфа-канал используется как маска, цвет берётся из темы
// (чёрный в светлой, светлый в тёмной). Fluent остаётся <img>, чтобы не
// потерять его собственные цвета/градиенты.
function IconGlyph({ family, name, className }: { family: IconFamily; name: string; className?: string }) {
  const src = iconSrc(family, name);
  if (family === "material") {
    return (
      <span
        aria-hidden
        className={cn("inline-block bg-current", className)}
        style={{
          maskImage: `url(${src})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskImage: `url(${src})`,
          WebkitMaskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={cn("object-contain", className)} />;
}

function IconGrid({
  value,
  onChange,
  families = GENERAL_ICON_FAMILIES,
}: {
  value: string | null | undefined;
  onChange: (iconKey: string) => void;
  families?: readonly IconFamily[];
}) {
  const t = useI18n();
  const parsedValue = parseIconKey(value);
  const [family, setFamily] = useState<IconFamily>(
    parsedValue && families.includes(parsedValue.family) ? parsedValue.family : families[0]
  );
  const [results, setResults] = useState<string[]>([]);

  // Поиск по названию убран целиком (фидбек пользователя 2026-07-13:
  // "нигде не нужен") — просто полный список коллекции по смене вкладки.
  useEffect(() => {
    const params = new URLSearchParams({ family });
    fetch(`/api/icon-library?${params}`)
      .then((res) => res.json())
      .then((data) => setResults(data.icons ?? []));
  }, [family]);

  const familyLabels: Record<IconFamily, string> = useMemo(
    () => ({
      fluent: t.iconPicker.familyFluent,
      material: t.iconPicker.familyMaterial,
      avatars: t.iconPicker.familyAvatars,
      // "app-icons" никогда не выбирается ни в одном picker'е (см.
      // icon-families.ts) — подпись сюда не попадёт, но Record должен быть
      // исчерпывающим по типу IconFamily.
      "app-icons": "App icons",
    }),
    [t]
  );

  return (
    <div className="flex flex-col gap-3 pt-2">
      <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.iconPicker.title}</h2>
      {families.length > 1 && (
        <div className="grid grid-cols-2 gap-1">
          {families.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFamily(f)}
              className={cn(
                "rounded-full px-2 py-1.5 text-center text-xs font-semibold",
                family === f ? "bg-primary/10 text-primary" : "bg-surface-0 text-muted-foreground"
              )}
            >
              {familyLabels[f]}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
        {results.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            onClick={() => onChange(`${family}${FAMILY_SEPARATOR}${name}`)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-control border border-border p-2 transition-colors hover:bg-muted",
              parsedValue?.family === family && parsedValue.name === name && "border-primary bg-primary/10"
            )}
          >
            <IconGlyph family={family} name={name} className="size-full" />
          </button>
        ))}
        {results.length === 0 && (
          <p className="col-span-full py-6 text-center text-body-airbnb text-muted-foreground">
            {t.iconPicker.noResults}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Searchable icon picker for Point/Zone/Asset (docs/spec/00-architecture.md).
 * Icons come from the personal SVG collection in public/icon-library/<family>/
 * (see public/icon-library/README.md), served via /api/icon-library — not bundled,
 * not a static npm icon set. `iconKey` is stored as `"<family>:<name>"`.
 *
 * Self-contained trigger + sheet, for create-forms. For a kebab-menu-driven
 * "change icon" action (sheet already open/closed by the kebab), use
 * `IconPickerSheet` instead — same grid, controlled `open`/`onClose`, no
 * trigger button of its own.
 */
export function IconPicker({
  value,
  onChange,
  families,
}: {
  value: string | null | undefined;
  onChange: (iconKey: string) => void;
  families?: readonly IconFamily[];
}) {
  const t = useI18n();
  const [open, setOpen] = useState(false);
  const parsed = parseIconKey(value);

  return (
    <>
      <PressableScale className="w-fit">
        <Button type="button" variant="outline" size="sm" className="w-fit gap-2" onClick={() => setOpen(true)}>
          {parsed ? (
            <IconGlyph family={parsed.family} name={parsed.name} className="size-4" />
          ) : (
            <Smile className="size-4" />
          )}
          {parsed?.name ?? t.iconPicker.selectIcon}
        </Button>
      </PressableScale>

      <BottomSheet open={open} onClose={() => setOpen(false)} className="max-h-[80vh]">
        <IconGrid
          value={value}
          families={families}
          onChange={(iconKey) => {
            onChange(iconKey);
            setOpen(false);
          }}
        />
      </BottomSheet>
    </>
  );
}

export function IconPickerSheet({
  open,
  onClose,
  value,
  onChange,
  families,
}: {
  open: boolean;
  onClose: () => void;
  value: string | null | undefined;
  onChange: (iconKey: string) => void;
  families?: readonly IconFamily[];
}) {
  return (
    <BottomSheet open={open} onClose={onClose} className="max-h-[80vh]">
      <IconGrid
        value={value}
        families={families}
        onChange={(iconKey) => {
          onChange(iconKey);
          onClose();
        }}
      />
    </BottomSheet>
  );
}

export function AssetOrZoneIcon({
  iconKey,
  className,
}: {
  iconKey: string | null | undefined;
  className?: string;
}) {
  const parsed = parseIconKey(iconKey);
  if (!parsed) return null;
  return <IconGlyph family={parsed.family} name={parsed.name} className={className} />;
}
