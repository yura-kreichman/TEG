"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { InfoTooltip } from "@/components/info-tooltip";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Label } from "@/components/ui/label";
import { TimeInput } from "@/components/time-input";
import { SavedCheckmark } from "@/components/ui/saved-checkmark";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatDuration } from "@/lib/datetime-format";
import type { Dictionary } from "@/lib/i18n";
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

/**
 * Допуск — это ДЛИТЕЛЬНОСТЬ, и выбирается из закрытого списка, а не вводится
 * свободно (требование пользователя 2026-08-06: "пользователь не должен иметь
 * возможность выбрать время, которое не будет работать").
 *
 * Свободное поле ЧЧ:ММ этого обещать не может. Оно позволяло, например, 23
 * часа — а если "раньше" и "позже" в сумме дают сутки и больше, проверка окна
 * в isWithinShiftStartWindow выключается ЦЕЛИКОМ и возвращает "можно всегда".
 * То есть внутри числового поля был спрятан рубильник, на который можно
 * наступить случайно. Максимум списка — 9 часов, значит сумма физически не
 * дотягивает до суток и та ветка недостижима.
 *
 * Второй неработающий вариант — нули с обеих сторон: окно шириной в одну
 * минуту, начать смену практически невозможно. Поэтому ноль на одной стороне
 * запрещён, когда на другой уже ноль (нулевой допуск с одной стороны как
 * политика — законно, но не с двух сразу).
 *
 * Подпись нуля нейтральная ("Нет"), а не "Не раньше": ключ один и тот же на
 * оба поля, привязать его к одной стороне нельзя.
 */
const TOLERANCE_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 540];

function formatToleranceLabel(minutes: number, t: Dictionary): string {
  if (minutes === 0) return t.settings.toleranceNone;
  if (minutes < 60) return `${minutes} ${t.operatorApp.workTime.minutesShort}`;
  return formatDuration(minutes, t);
}

function ToleranceSelect({
  value,
  otherValue,
  onChange,
  t,
}: {
  value: number;
  otherValue: number;
  onChange: (minutes: number) => void;
  t: Dictionary;
}) {
  // Значение из прошлых версий могло быть любым (поле было свободным) — тогда
  // показываем его как есть, отдельным пунктом, а не подменяем ближайшим:
  // экран обязан показывать то, что реально сохранено.
  const options = TOLERANCE_OPTIONS.includes(value)
    ? TOLERANCE_OPTIONS
    : [...TOLERANCE_OPTIONS, value].sort((a, b) => a - b);

  // items обязателен, а не только children: SelectValue берёт ПОДПИСЬ выбранного
  // пункта именно оттуда. Без него на кнопке оставалось сырое значение — "120"
  // вместо "2 ч" (реальная ошибка, замечена пользователем 2026-08-06).
  const items = options.map((m) => ({ value: String(m), label: formatToleranceLabel(m, t) }));

  return (
    <Select value={String(value)} onValueChange={(v) => v && onChange(Number(v))} items={items}>
      <SelectTrigger className="h-10 w-auto shrink-0 gap-1.5 px-2.5">
        <SelectValue />
      </SelectTrigger>
      {/* Две колонки и своя ширина вместо ширины кнопки: пунктов дюжина, а
          кнопка узкая — список получался длинной ниткой в один символ. */}
      <SelectContent align="end" className="grid w-auto min-w-60 grid-cols-2 gap-0.5">
        {options.map((m) => (
          <SelectItem
            key={m}
            value={String(m)}
            disabled={m === 0 && otherValue === 0}
            className="min-h-11 px-2.5"
          >
            {formatToleranceLabel(m, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

  function saveTolerance(field: ToleranceField, totalMinutes: number) {
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
            {/* Время суток — значит TimeInput, тот же, что у фиксированного
                времени отправки сводки (запрос пользователя 2026-08-06:
                колесо занимало пол-экрана и было отдельной механикой). Допуск
                ниже — уже не время, а длительность, поэтому там список.
                Любое значение здесь рабочее: это просто час начала смены. */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="defaultShiftStart">{t.settings.defaultShiftStartLabel}</Label>
                  <InfoTooltip text={t.settings.defaultShiftStartHint} />
                </div>
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
              <span className="flex items-center gap-1.5">
                <span className="text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.settings.startWindowCardLabel}
                </span>
                <InfoTooltip text={t.settings.startWindowHint} />
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <Label>{t.settings.earlierByLabel}</Label>
              <ToleranceSelect
                value={earlyMinutes}
                otherValue={lateMinutes}
                onChange={(m) => saveTolerance("earlyToleranceMinutes", m)}
                t={t}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label>{t.settings.laterByLabel}</Label>
              <ToleranceSelect
                value={lateMinutes}
                otherValue={earlyMinutes}
                onChange={(m) => saveTolerance("lateToleranceMinutes", m)}
                t={t}
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
