"use client";

import { useEffect, useMemo, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

function offsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("ru", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const gmt = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${timeZone.replace(/_/g, " ")} (${gmt})`;
  } catch {
    return timeZone;
  }
}

/**
 * Часовой пояс тенанта (docs/spec/00-architecture.md) — общий для владельца
 * и всех его операторов, задаёт только владелец. Список зон — из
 * Intl.supportedValuesOf на сервере (см. /api/tenant/timezone), здесь только
 * сортировка и подпись со смещением UTC для читаемости.
 */
export function TimezonePicker() {
  // Список зон одинаков для всех тенантов и не зависит от асинхронных данных —
  // ленивый инициализатор useState, не эффект: гоняем статику Intl прямо в
  // браузере, не через отдельный запрос к API на 400+ строк.
  const [options] = useState<string[]>(() => [...Intl.supportedValuesOf("timeZone")].sort());
  const [current, setCurrent] = useState<string>("UTC");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/timezone")
      .then((res) => res.json())
      .then((data) => setCurrent(data.timezone ?? "UTC"));
  }, []);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const tz of options) map.set(tz, offsetLabel(tz));
    if (!map.has(current)) map.set(current, offsetLabel(current));
    return map;
  }, [options, current]);

  async function handleSelect(timezone: string | null) {
    if (!timezone) return;
    setSaving(true);
    setCurrent(timezone);
    await fetch("/api/tenant/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    });
    setSaving(false);
  }

  if (options.length === 0) return null;

  return (
    <Select value={current} onValueChange={handleSelect} disabled={saving}>
      <SelectTrigger className="max-w-xs">
        <SelectValue>{labels.get(current) ?? current}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {labels.get(tz)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
