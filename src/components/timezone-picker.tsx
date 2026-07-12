"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";
import { getAllowedTimezones } from "@/lib/locales";

function offsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("ru", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function displayName(timeZone: string): string {
  return timeZone.replace(/_/g, " ");
}

/**
 * Часовой пояс тенанта (docs/spec/00-architecture.md) — общий для владельца
 * и всех его операторов, задаёт только владелец. Список ограничен странами
 * языков RentOS (см. lib/locales.ts), а не всеми ~400 зонами IANA — bottom
 * sheet с поиском вместо плоского Select, как IconPicker/AssetPicker.
 * Кнопка "Авто" рядом с текущим значением всегда предлагает подставить
 * часовой пояс браузера, не только при первой настройке.
 */
export function TimezonePicker() {
  const t = useI18n();
  const [options] = useState<string[]>(() => getAllowedTimezones());
  const [current, setCurrent] = useState<string>("UTC");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/tenant/timezone")
      .then((res) => res.json())
      .then((data) => {
        setCurrent(data.timezone ?? "UTC");
      });
  }, []);

  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((tz) => tz.toLowerCase().includes(q.replace(/\s+/g, "_")));
  }, [options, query]);

  async function applyTimezone(timezone: string) {
    setSaving(true);
    setCurrent(timezone);
    setOpen(false);
    setQuery("");
    await fetch("/api/tenant/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    });
    setSaving(false);
  }

  // Кнопка "Авто" скрыта, если определённая браузером зона не входит в
  // разрешённый список (страна языков RentOS) — валидный кейс (браузер вне
  // этих стран), не баг, просто нечего применять; иначе клик молча падал бы
  // на серверной валидации без обратной связи пользователю.
  const canAuto = Boolean(detectedTimezone && options.includes(detectedTimezone));

  return (
    <>
      {/* flex-1 на триггере (фидбек 2026-07-12: выровнять по ширине карточки,
          как языковой Select) — вся строка растягивается до края карточки
          вместо w-fit с пустым местом справа. */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => setOpen(true)}
          className="flex-1 justify-start gap-2"
        >
          <span className="truncate">
            {displayName(current)} ({offsetLabel(current)})
          </span>
        </Button>
        {canAuto && (
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={saving || detectedTimezone === current}
            onClick={() => applyTimezone(detectedTimezone!)}
          >
            {t.settings.timezoneAuto}
          </Button>
        )}
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} className="max-h-[80vh]">
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.settings.timezoneTitle}</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={t.settings.timezoneSearchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* Компактнее и в 2 колонки (фидбек 2026-07-12): 47 зон помещаются
              почти вдвое компактнее, чем в один столбец построчно. Без
              border-t между строками (не выравнивался бы между колонками
              на первой строке) — вместо этого rounded-control блоки с
              hover/highlight фоном, как у языкового переключателя. */}
          <div className="grid grid-cols-2 gap-1 overflow-y-auto">
            {filtered.map((tz) => (
              <button
                key={tz}
                type="button"
                onClick={() => applyTimezone(tz)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-caption-airbnb hover:bg-muted",
                  tz === current && "bg-muted font-bold text-primary"
                )}
              >
                <span className="truncate">{displayName(tz)}</span>
                <span className="shrink-0 tabular-nums">{offsetLabel(tz)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-2 py-6 text-center text-body-airbnb text-muted-foreground">
                {t.settings.timezoneNoResults}
              </p>
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
