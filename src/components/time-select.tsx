"use client";

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
function minutesForStep(step: number): number[] {
  return step <= 1 ? Array.from({ length: 60 }, (_, i) => i) : Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
}
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Compact HH : MM control — two dropdowns instead of WheelTimePicker's
 * scroll-wheel columns, for settings rows where a full wheel picker takes up
 * too much screen space (docs feedback 2026-07-11). Also reused for plain
 * durations (допуск начала смены) via `maxHour`/`minuteStep` — the value is
 * still an {hour, minute} pair, the caller decides whether it means a time of
 * day or an elapsed duration.
 */
export function TimeSelect({
  hour,
  minute,
  maxHour = 23,
  minuteStep = 1,
  onChange,
}: {
  hour: number;
  minute: number;
  maxHour?: number;
  minuteStep?: number;
  onChange: (v: { hour: number; minute: number }) => void;
}) {
  const hours = ALL_HOURS.filter((h) => h <= maxHour);
  const minutes = minutesForStep(minuteStep);
  const snappedMinute = minutes.reduce((closest, v) => (Math.abs(v - minute) < Math.abs(closest - minute) ? v : closest));
  const hourStr = pad(hour);
  const minuteStr = pad(snappedMinute);

  return (
    <div className="flex items-center gap-1">
      <Select
        value={hourStr}
        onValueChange={(v) => v && onChange({ hour: Number(v), minute: snappedMinute })}
        items={hours.map((h) => ({ value: pad(h), label: pad(h) }))}
      >
        <SelectTrigger className="h-10 w-[68px] px-2.5 tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hours.map((h) => (
            <SelectItem key={h} value={pad(h)} className="tabular-nums">
              {pad(h)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-body-airbnb font-bold text-muted-foreground">:</span>
      <Select
        value={minuteStr}
        onValueChange={(v) => v && onChange({ hour, minute: Number(v) })}
        items={minutes.map((m) => ({ value: pad(m), label: pad(m) }))}
      >
        <SelectTrigger className="h-10 w-[68px] px-2.5 tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {minutes.map((m) => (
            <SelectItem key={m} value={pad(m)} className="tabular-nums">
              {pad(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
