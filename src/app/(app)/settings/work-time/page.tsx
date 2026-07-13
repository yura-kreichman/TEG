"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Label } from "@/components/ui/label";
import { WheelTimePicker } from "@/components/wheel-time-picker";
import { TimeSelect } from "@/components/time-select";
import { toleranceCrossesBusinessDayBoundary } from "@/lib/business-day";

type ToleranceField = "earlyToleranceMinutes" | "lateToleranceMinutes";
type FieldKey = "defaultShiftStartTime" | "businessDayBoundary" | ToleranceField;

export default function WorkTimeSettingsPage() {
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [startHour, setStartHour] = useState(10);
  const [startMinute, setStartMinute] = useState(0);
  const [boundaryHour, setBoundaryHour] = useState(6);
  const [boundaryMinute, setBoundaryMinute] = useState(0);
  const [earlyMinutes, setEarlyMinutes] = useState(120);
  const [lateMinutes, setLateMinutes] = useState(120);
  const [savedField, setSavedField] = useState<FieldKey | null>(null);

  useEffect(() => {
    fetch("/api/tenant/work-time-settings")
      .then((res) => res.json())
      .then((data) => {
        const [sh, sm] = String(data.defaultShiftStartTime ?? "10:00").split(":").map(Number);
        setStartHour(sh);
        setStartMinute(sm);
        const [bh, bm] = String(data.businessDayBoundary ?? "06:00").split(":").map(Number);
        setBoundaryHour(bh);
        setBoundaryMinute(bm);
        setEarlyMinutes(data.earlyToleranceMinutes ?? 120);
        setLateMinutes(data.lateToleranceMinutes ?? 120);
        setChecking(false);
      });
  }, []);

  // Все поля — общетенантные, сохраняются сразу по изменению (без отдельной
  // кнопки "Сохранить") — идентичные по виду и поведению контролы (фидбек
  // пользователя 2026-07-11: раньше выглядели и вели себя по-разному).
  async function savePatch(field: FieldKey, value: string | number) {
    await fetch("/api/tenant/work-time-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    setSavedField(field);
    setTimeout(() => setSavedField((current) => (current === field ? null : current)), 1500);
  }

  function saveTimeField(field: "defaultShiftStartTime" | "businessDayBoundary", hour: number, minute: number) {
    savePatch(field, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }

  function saveTolerance(field: ToleranceField, hour: number, minute: number) {
    const totalMinutes = hour * 60 + minute;
    if (field === "earlyToleranceMinutes") setEarlyMinutes(totalMinutes);
    else setLateMinutes(totalMinutes);
    savePatch(field, totalMinutes);
  }

  const defaultShiftStartTime = `${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}`;
  const businessDayBoundary = `${String(boundaryHour).padStart(2, "0")}:${String(boundaryMinute).padStart(2, "0")}`;
  const crossesBoundary = useMemo(
    () => toleranceCrossesBusinessDayBoundary(defaultShiftStartTime, businessDayBoundary, earlyMinutes, lateMinutes),
    [defaultShiftStartTime, businessDayBoundary, earlyMinutes, lateMinutes]
  );

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-3">
          <Link href="/settings" className="mb-1 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.settings.title}
          </Link>
          <h1 className="text-screen-title">{t.settings.workTimeTitle}</h1>
          <p className="mb-1 text-caption-airbnb">{t.settings.workTimeHint}</p>

          <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <Label>{t.settings.defaultShiftStartLabel}</Label>
                <WheelTimePicker
                  hour={startHour}
                  minute={startMinute}
                  minuteStep={10}
                  onChange={(v) => {
                    setStartHour(v.hour);
                    setStartMinute(v.minute);
                    saveTimeField("defaultShiftStartTime", v.hour, v.minute);
                  }}
                />
                <span className="text-caption-airbnb">{t.settings.defaultShiftStartHint}</span>
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <Label>{t.settings.businessDayBoundaryLabel}</Label>
                <WheelTimePicker
                  hour={boundaryHour}
                  minute={boundaryMinute}
                  minuteStep={10}
                  onChange={(v) => {
                    setBoundaryHour(v.hour);
                    setBoundaryMinute(v.minute);
                    saveTimeField("businessDayBoundary", v.hour, v.minute);
                  }}
                />
                <span className="text-caption-airbnb">{t.settings.businessDayBoundaryHint}</span>
              </div>
            </div>
            {(savedField === "defaultShiftStartTime" || savedField === "businessDayBoundary") && (
              <p className="text-center text-body-airbnb text-success">{t.common.saved}</p>
            )}
          </SpringCard>

          <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
            <div>
              <span className="mb-1 block text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                {t.settings.startWindowCardLabel}
              </span>
              <p className="text-caption-airbnb">{t.settings.startWindowHint}</p>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <Label>{t.settings.earlierLabel}</Label>
              <TimeSelect
                hour={Math.floor(earlyMinutes / 60)}
                minute={earlyMinutes % 60}
                maxHour={6}
                minuteStep={10}
                onChange={(v) => saveTolerance("earlyToleranceMinutes", v.hour, v.minute)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label>{t.settings.laterLabel}</Label>
              <TimeSelect
                hour={Math.floor(lateMinutes / 60)}
                minute={lateMinutes % 60}
                maxHour={6}
                minuteStep={10}
                onChange={(v) => saveTolerance("lateToleranceMinutes", v.hour, v.minute)}
              />
            </div>
            {(savedField === "earlyToleranceMinutes" || savedField === "lateToleranceMinutes") && (
              <p className="text-center text-body-airbnb text-success">{t.common.saved}</p>
            )}
            {crossesBoundary && (
              <div className="flex items-start gap-2 rounded-control bg-warning/10 p-3 text-caption-airbnb text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{t.settings.startWindowBoundaryWarning}</span>
              </div>
            )}
          </SpringCard>
        </div>
      </div>
    </OwnerShell>
  );
}
