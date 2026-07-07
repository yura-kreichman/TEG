"use client";

import { useMemo, useState } from "react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { Search } from "lucide-react";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 90;

function isIconName(value: string): value is IconName {
  return (iconNames as readonly string[]).includes(value);
}

function IconGrid({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (iconKey: string) => void;
}) {
  const t = useI18n();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return iconNames.slice(0, MAX_RESULTS);
    return iconNames.filter((name) => name.includes(q)).slice(0, MAX_RESULTS);
  }, [query]);

  return (
    <div className="flex flex-col gap-3 pt-2">
      <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.iconPicker.title}</h2>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          placeholder={t.iconPicker.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
        {results.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            onClick={() => onChange(name)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-control border-2 border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              value === name && "border-primary text-primary"
            )}
          >
            <DynamicIcon name={name} className="size-5" />
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
 * Icon names are lucide's own kebab-case keys (`iconNames` from
 * "lucide-react/dynamic") — stored as-is in `iconKey`, rendered anywhere via
 * `<DynamicIcon name={iconKey} />`. Using the dynamic entry point means the
 * ~3000-icon set is never bundled up front, only the icons actually shown.
 *
 * Self-contained trigger + sheet, for create-forms. For a kebab-menu-driven
 * "change icon" action (sheet already open/closed by the kebab), use
 * `IconPickerSheet` instead — same grid, controlled `open`/`onClose`, no
 * trigger button of its own.
 */
export function IconPicker({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (iconKey: string) => void;
}) {
  const t = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <PressableScale className="w-fit">
        <Button type="button" variant="outline" className="w-fit gap-2" onClick={() => setOpen(true)}>
          {value && isIconName(value) ? (
            <DynamicIcon name={value} className="size-4" />
          ) : (
            <Search className="size-4" />
          )}
          {value ?? t.iconPicker.selectIcon}
        </Button>
      </PressableScale>

      <BottomSheet open={open} onClose={() => setOpen(false)} className="max-h-[80vh]">
        <IconGrid
          value={value}
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
}: {
  open: boolean;
  onClose: () => void;
  value: string | null | undefined;
  onChange: (iconKey: string) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} className="max-h-[80vh]">
      <IconGrid
        value={value}
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
  if (!iconKey || !isIconName(iconKey)) return null;
  return <DynamicIcon name={iconKey} className={className} />;
}
