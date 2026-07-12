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
 * и всех его операторов, задаёт только владелец. Плоский Select с 400+
 * зонами оказался неюзабельным без поиска (фидбек пользователя 2026-07-12) —
 * заменено на bottom sheet с поиском, как IconPicker/AssetPicker. Если
 * тенант ещё ни разу не выбирал зону (хранится дефолт "UTC"), предлагаем
 * определить её по часовому поясу браузера, а не молча оставлять UTC.
 */
export function TimezonePicker() {
  const t = useI18n();
  const [options] = useState<string[]>(() => getAllowedTimezones());
  const [current, setCurrent] = useState<string>("UTC");
  const [everCustomized, setEverCustomized] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/tenant/timezone")
      .then((res) => res.json())
      .then((data) => {
        setCurrent(data.timezone ?? "UTC");
        setEverCustomized(data.timezone !== "UTC");
      });
  }, []);

  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);
  // Не предлагаем определённую браузером зону, если она не входит в
  // разрешённый список (страна языков RentOS) — иначе кнопка "применить"
  // молча падала бы на серверной валидации без обратной связи пользователю.
  const suggestDetected =
    !everCustomized && detectedTimezone && detectedTimezone !== current && options.includes(detectedTimezone);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((tz) => tz.toLowerCase().includes(q.replace(/\s+/g, "_")));
  }, [options, query]);

  async function applyTimezone(timezone: string) {
    setSaving(true);
    setCurrent(timezone);
    setEverCustomized(true);
    setOpen(false);
    setQuery("");
    await fetch("/api/tenant/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    });
    setSaving(false);
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(true)} className="w-fit max-w-full justify-start gap-2">
        <span className="truncate">
          {displayName(current)} ({offsetLabel(current)})
        </span>
      </Button>

      {suggestDetected && (
        <button
          type="button"
          onClick={() => applyTimezone(detectedTimezone!)}
          className="flex w-fit items-center gap-1.5 text-caption-airbnb font-semibold text-primary"
        >
          {t.settings.timezoneDetectedPrefix} «{displayName(detectedTimezone!)} ({offsetLabel(detectedTimezone!)})» —{" "}
          {t.settings.timezoneDetectedApply}
        </button>
      )}

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
          <div className="flex flex-col overflow-y-auto">
            {filtered.map((tz) => (
              <button
                key={tz}
                type="button"
                onClick={() => applyTimezone(tz)}
                className={cn(
                  "flex items-center justify-between gap-3 border-t border-border py-3 text-left text-body-airbnb first:border-t-0",
                  tz === current && "font-bold text-primary"
                )}
              >
                <span className="truncate">{displayName(tz)}</span>
                <span className="shrink-0 text-caption-airbnb tabular-nums">{offsetLabel(tz)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-body-airbnb text-muted-foreground">{t.settings.timezoneNoResults}</p>
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
