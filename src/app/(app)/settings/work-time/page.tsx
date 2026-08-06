"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Label } from "@/components/ui/label";
import { TimeInput } from "@/components/time-input";
import { SavedCheckmark } from "@/components/ui/saved-checkmark";
import { Switch } from "@/components/ui/switch";
import { toleranceCrossesBusinessDayBoundary } from "@/lib/business-day";

type ToleranceField = "earlyToleranceMinutes" | "lateToleranceMinutes";
type FieldKey = "defaultShiftStartTime" | "businessDayBoundary" | ToleranceField;

// Два значения границы вместо свободного часа. Шесть утра покрывают весь
// реальный диапазон детского проката: закрылись в три-четыре ночи, открылись
// в десять. Точный час владельцу знать незачем — если однажды появится
// случай, которому шести утра мало, поле добавится тогда, спрятанным за
// включённым тумблером.
const MIDNIGHT = "00:00";
const NIGHT_BOUNDARY = "06:00";

export default function WorkTimeSettingsPage() {
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [startHour, setStartHour] = useState(10);
  const [startMinute, setStartMinute] = useState(0);
  // Граница дня больше не спрашивается часами (решение пользователя
  // 2026-08-06). Владелец отвечает на вопрос про свой бизнес — работаете ли
  // после полуночи — а точный час хранится внутри: NIGHT_BOUNDARY при "да",
  // полночь при "нет". Прежний WheelTimePicker давал 1440 вариантов, из
  // которых верны единицы: у Керен Центра стояло 22:00 при закрытии в 20:10,
  // то есть любая задержавшаяся сдача уехала бы в следующий день.
  const [worksPastMidnight, setWorksPastMidnight] = useState(false);
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
        setWorksPastMidnight(String(data.businessDayBoundary ?? MIDNIGHT) !== MIDNIGHT);
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

  // Тумблеры по всему проекту сохраняются молча (см. Настройки → Система):
  // сам сдвинувшийся переключатель и есть подтверждение, галочка рядом с ним
  // была бы вторым сообщением об одном и том же.
  async function saveSilently(field: FieldKey, value: string | number) {
    await fetch("/api/tenant/work-time-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
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
  const businessDayBoundary = worksPastMidnight ? NIGHT_BOUNDARY : MIDNIGHT;
  const crossesBoundary = useMemo(
    () => toleranceCrossesBusinessDayBoundary(defaultShiftStartTime, businessDayBoundary, earlyMinutes, lateMinutes),
    [defaultShiftStartTime, businessDayBoundary, earlyMinutes, lateMinutes]
  );

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-3">
          <BackLink label={t.settings.title} href="/settings" className="mb-1" />
          <h1 className="text-screen-title">{t.settings.workTimeTitle}</h1>
          <p className="mb-1 text-caption-airbnb">{t.settings.workTimeHint}</p>

          <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
            {/* Тот же контрол, что у допуска ниже (запрос пользователя
                2026-08-06): колесо занимало пол-экрана и выглядело отдельной
                механикой рядом с обычными полями времени в той же настройке. */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="defaultShiftStart">{t.settings.defaultShiftStartLabel}</Label>
                <TimeInput
                  id="defaultShiftStart"
                  className="h-10 w-fit"
                  value={defaultShiftStartTime}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
                    setStartHour(h);
                    setStartMinute(m);
                    saveTimeField("defaultShiftStartTime", h, m);
                  }}
                />
              </div>
              <p className="mt-1 text-caption-airbnb">{t.settings.defaultShiftStartHint}</p>
            </div>
            {/* Вопрос про бизнес, а не про архитектуру. Подпись обязательна:
                без неё непонятно, зачем спрашивают — и половина ответит
                наугад, а от ответа зависит день во всех отчётах. */}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <div className="min-w-0">
                <div className="text-body-airbnb">{t.settings.worksPastMidnightLabel}</div>
                <div className="text-caption-airbnb">{t.settings.worksPastMidnightHint}</div>
              </div>
              <Switch
                checked={worksPastMidnight}
                onCheckedChange={(v) => {
                  setWorksPastMidnight(v);
                  saveSilently("businessDayBoundary", v ? NIGHT_BOUNDARY : MIDNIGHT);
                }}
                className="shrink-0"
              />
            </div>
            <SavedCheckmark show={savedField === "defaultShiftStartTime"} />
          </SpringCard>

          <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
            <div>
              <span className="mb-1 block text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                {t.settings.startWindowCardLabel}
              </span>
              <p className="text-caption-airbnb">{t.settings.startWindowHint}</p>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <Label htmlFor="earlyTolerance">{t.settings.earlierLabel}</Label>
              <TimeInput
                id="earlyTolerance"
                className="h-10 w-fit"
                value={`${String(Math.floor(earlyMinutes / 60)).padStart(2, "0")}:${String(earlyMinutes % 60).padStart(2, "0")}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (Number.isFinite(h) && Number.isFinite(m)) saveTolerance("earlyToleranceMinutes", h, m);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="lateTolerance">{t.settings.laterLabel}</Label>
              <TimeInput
                id="lateTolerance"
                className="h-10 w-fit"
                value={`${String(Math.floor(lateMinutes / 60)).padStart(2, "0")}:${String(lateMinutes % 60).padStart(2, "0")}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (Number.isFinite(h) && Number.isFinite(m)) saveTolerance("lateToleranceMinutes", h, m);
                }}
              />
            </div>
            <SavedCheckmark
              show={savedField === "earlyToleranceMinutes" || savedField === "lateToleranceMinutes"}
            />
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
