"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { WheelTimePicker } from "@/components/wheel-time-picker";
import { useI18n } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { cn } from "@/lib/utils";
import { formatDuration as formatDurationBase, formatTime, nowInTimezone } from "@/lib/datetime-format";
import {
  formatPeriodLabel as formatPeriodLabelFor,
  isCurrentPeriod as isCurrentPeriodFor,
  periodRange as periodRangeFor,
  steppedAnchor,
  type PeriodGranularity,
} from "@/lib/period-nav";

interface Balance {
  toPayOut: number;
  earnedInPeriod: number;
  rateEarnedInPeriod: number;
  advancesInPeriod: number;
  bonusesInPeriod: number;
  currentRate: number;
}

interface ShiftRow {
  id: string;
  startAt: string;
  endAt: string;
  minutes: number;
  rate: number;
  accrued: number;
  advanceAmount: number;
  bonusAmount: number;
}

interface StandaloneMoneyOp {
  id: string;
  type: "advance" | "bonus_payout";
  amount: number;
  occurredAt: string;
  comment: string | null;
}

// Часы, пересекающиеся с окном допуска [центр−early; центр+late] с учётом
// переноса через полночь — ограничивает колесо "Пришёл" в ручном режиме
// (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА ВРЕМЕНИ"). Проверяем обе границы
// часа (h*60 и h*60+59), сравнивая во всех трёх сдвигах на сутки, чтобы не
// зависеть от того, где именно проходит полночь относительно окна.
function allowedStartHours(centerTime: string, earlyMinutes: number, lateMinutes: number): number[] {
  const [ch, cm] = centerTime.split(":").map(Number);
  const centerMin = ch * 60 + cm;
  if (earlyMinutes + lateMinutes >= 24 * 60) return Array.from({ length: 24 }, (_, i) => i);
  const lower = centerMin - earlyMinutes;
  const upper = centerMin + lateMinutes;
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    const inWindow = [h * 60, h * 60 + 59].some((probe) =>
      [probe, probe - 1440, probe + 1440].some((p) => p >= lower && p <= upper)
    );
    if (inWindow) hours.push(h);
  }
  return hours;
}

export default function WorkTimePage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [standaloneMoneyOps, setStandaloneMoneyOps] = useState<StandaloneMoneyOp[]>([]);
  const [granularity, setGranularity] = useState<PeriodGranularity>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [defaultShiftStartTime, setDefaultShiftStartTime] = useState("10:00");
  const [earlyToleranceMinutes, setEarlyToleranceMinutes] = useState(120);
  const [lateToleranceMinutes, setLateToleranceMinutes] = useState(120);
  // Ручной ввод смены (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА ВРЕМЕНИ") —
  // доступен только в режиме "manual"; в "auto" время фиксирует только
  // check-in/check-out на главном экране.
  const [timeTrackingMode, setTimeTrackingMode] = useState<"manual" | "auto">("manual");

  const [formOpen, setFormOpen] = useState(false);
  const [startHour, setStartHour] = useState(9);
  const [startMinute, setStartMinute] = useState(0);
  const [endHour, setEndHour] = useState(18);
  const [endMinute, setEndMinute] = useState(0);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { saved: shiftSaved, pulse: shiftPulse } = useSavePulse();
  const [tenantTimezone, setTenantTimezone] = useState("UTC");

  // Самостоятельный запрос аванса/премии посреди смены, без её закрытия —
  // только auto-режим (docs/spec/05-work-time.md, "АВАНС": «...или отдельно
  // в PWA»; в manual аванс/премия уже вводятся вместе с формой смены).
  const [advanceRequestOpen, setAdvanceRequestOpen] = useState(false);
  const [advanceRequestAmount, setAdvanceRequestAmount] = useState("");
  const [bonusRequestAmount, setBonusRequestAmount] = useState("");
  const [advanceRequestSubmitting, setAdvanceRequestSubmitting] = useState(false);
  const [advanceRequestError, setAdvanceRequestError] = useState<string | null>(null);
  const { saved: advanceRequestSaved, pulse: advanceRequestPulse } = useSavePulse();

  const [notice, setNotice] = useState<{ warnings: string[]; noResultsToday: boolean } | null>(null);

  async function loadData() {
    const { from, to } = periodRangeFor(granularity, anchor);
    const [summaryRes, shiftsRes, meRes, timezoneRes] = await Promise.all([
      fetch(`/api/operator/work-time/summary?from=${from}&to=${to}`),
      fetch(`/api/operator/work-time/shifts?from=${from}&to=${to}`),
      fetch("/api/auth/operator/me"),
      fetch("/api/operator/tenant-timezone"),
    ]);
    if (summaryRes.status === 401 || shiftsRes.status === 401) {
      router.replace("/operator/login");
      return;
    }
    if (summaryRes.status === 403 || shiftsRes.status === 403) {
      router.replace("/operator");
      return;
    }
    if (meRes.ok) {
      const meData = await meRes.json();
      setTimeTrackingMode(meData.timeTrackingMode === "auto" ? "auto" : "manual");
    }
    if (timezoneRes.ok) {
      const timezoneData = await timezoneRes.json();
      setTenantTimezone(timezoneData.timezone ?? "UTC");
    }
    const summaryData = await summaryRes.json();
    setBalance(summaryData);
    setDefaultShiftStartTime(summaryData.defaultShiftStartTime ?? "10:00");
    setEarlyToleranceMinutes(summaryData.earlyToleranceMinutes ?? 120);
    setLateToleranceMinutes(summaryData.lateToleranceMinutes ?? 120);
    const shiftsData = await shiftsRes.json();
    setShifts(shiftsData.shifts ?? []);
    setStandaloneMoneyOps(shiftsData.standaloneMoneyOps ?? []);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, anchor]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function isCurrentPeriod() {
    return isCurrentPeriodFor(granularity, anchor);
  }

  function stepPeriod(delta: number) {
    if (delta > 0 && isCurrentPeriod()) return;
    setAnchor(steppedAnchor(granularity, anchor, delta));
  }

  function formatPeriodLabel() {
    return formatPeriodLabelFor(granularity, anchor, t);
  }

  function openForm() {
    // "Пришёл" по умолчанию — время из настроек владельца (Settings ->
    // Рабочее время), было зашито как 10:00, теперь настраиваемо; "ушёл" —
    // реальное текущее время, чтобы форма сразу отражала "я ухожу прямо
    // сейчас". Реальный баг, найден пользователем 2026-07-22: раньше бралось
    // через date.getHours()/getMinutes() — часовой пояс УСТРОЙСТВА оператора,
    // не бизнес-часовой пояс тенанта (см. nowInTimezone, src/lib/datetime-
    // format.ts) — на устройстве с другим системным поясом, чем у точки,
    // подставлялось неверное время.
    const [defaultHour, defaultMinute] = defaultShiftStartTime.split(":").map(Number);
    const { hour: nowHour, minute: nowMinute } = nowInTimezone(tenantTimezone);
    setStartHour(defaultHour);
    setStartMinute(defaultMinute);
    setEndHour(nowHour);
    setEndMinute(nowMinute);
    setAdvanceAmount("");
    setBonusAmount("");
    setSubmitError(null);
    setFormOpen(true);
  }

  const searchParams = useSearchParams();
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // "Добавить смену" с главного экрана (?add=1) — сразу открыть форму, не
    // заставляя оператора ещё раз тапать по кнопке на этой странице. Только
    // в ручном режиме — в авто время фиксирует check-in/check-out.
    if (!checking && timeTrackingMode === "manual" && searchParams.get("add") === "1") {
      openForm();
      router.replace("/operator/work-time");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, timeTrackingMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmitShift() {
    setSubmitting(true);
    setSubmitError(null);
    // Локальные компоненты даты/времени устройства — не UTC, иначе введённые
    // часы:минуты сместятся на разницу часовых поясов при отправке на сервер.
    const today = new Date();
    const startAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), startHour, startMinute);
    let endAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), endHour, endMinute);
    if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);

    try {
      const res = await fetch("/api/operator/work-time/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          advanceAmount: advanceAmount ? Number(advanceAmount) : 0,
          bonusAmount: bonusAmount ? Number(bonusAmount) : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? t.operatorApp.workTime.saveError);
        return;
      }
      shiftPulse(() => setFormOpen(false));
      if (data.warnings?.length || data.noResultsToday) {
        setNotice({ warnings: data.warnings ?? [], noResultsToday: !!data.noResultsToday });
      } else {
        setNotice(null);
      }
      await loadData();
    } finally {
      setSubmitting(false);
    }
  }

  function openAdvanceRequest() {
    setAdvanceRequestAmount("");
    setBonusRequestAmount("");
    setAdvanceRequestError(null);
    setAdvanceRequestOpen(true);
  }

  async function submitAdvanceRequest() {
    const advance = advanceRequestAmount ? Number(advanceRequestAmount) : 0;
    const bonus = bonusRequestAmount ? Number(bonusRequestAmount) : 0;
    if (advance <= 0 && bonus <= 0) return;
    setAdvanceRequestSubmitting(true);
    setAdvanceRequestError(null);
    try {
      const res = await fetch("/api/operator/work-time/advance-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advanceAmount: advance, bonusAmount: bonus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdvanceRequestError(data.error ?? t.operatorApp.workTime.saveError);
        return;
      }
      advanceRequestPulse(() => setAdvanceRequestOpen(false));
      await loadData();
    } finally {
      setAdvanceRequestSubmitting(false);
    }
  }

  function formatDuration(minutes: number) {
    return formatDurationBase(minutes, t);
  }

  function formatShiftDate(iso: string) {
    const d = new Date(iso);
    return `${d.getDate()} ${t.readings.monthsGenitive[d.getMonth()]}`;
  }

  function warningText(code: string) {
    if (code === "too_long") return t.operatorApp.workTime.warningTooLong;
    return code;
  }

  if (checking || !balance) return null;

  // Смены и ручные авансы/премии (без смены) — одним хронологическим списком
  // (docs/spec/05-work-time.md, "РОЛИ И ВИДИМОСТЬ": оператор видит и то, и другое).
  type HistoryItem = { kind: "shift"; date: string; shift: ShiftRow } | { kind: "op"; date: string; op: StandaloneMoneyOp };
  const historyItems: HistoryItem[] = [
    ...shifts.map((s): HistoryItem => ({ kind: "shift", date: s.startAt, shift: s })),
    ...standaloneMoneyOps.map((o): HistoryItem => ({ kind: "op", date: o.occurredAt, op: o })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-8">
      <div className="flex w-full max-w-md flex-col gap-4 md:max-w-xl lg:max-w-2xl">
        <Link href="/operator" className="w-fit text-caption-airbnb font-semibold text-primary">
          ← {t.common.back}
        </Link>
        <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.workTime.title}</h1>

        {notice && (
          <div className="flex flex-col gap-1.5 rounded-control bg-warning/15 p-3">
            {notice.warnings.map((w) => (
              <p key={w} className="text-sm font-medium text-warning">
                {warningText(w)}
              </p>
            ))}
            {notice.noResultsToday && (
              <p className="text-sm font-medium text-warning">{t.operatorApp.workTime.noResultsTodayNote}</p>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="mt-1 flex w-fit items-center gap-1 text-xs font-semibold text-warning"
            >
              <X className="size-3.5" />
              {t.common.close}
            </button>
          </div>
        )}

        <SpringCard hover={false} className="flex flex-col gap-4">
          <div>
            <p className="text-caption-airbnb">{t.operatorApp.workTime.toPayOutLabel}</p>
            <p
              className={cn(
                "text-[2.125rem] font-extrabold tabular-nums tracking-[-0.02em]",
                balance.toPayOut < 0 && "text-destructive"
              )}
            >
              <Money value={balance.toPayOut} size="display" />
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3.5 tabular-nums">
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.earnedLabel}</p>
              <p className="text-[1.0625rem] font-bold text-primary"><Money value={balance.earnedInPeriod} /></p>
            </div>
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.rateAccruedLabel}</p>
              <p className="text-[1.0625rem] font-bold"><Money value={balance.rateEarnedInPeriod} /></p>
            </div>
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.bonusesLabel}</p>
              <p className="text-[1.0625rem] font-bold"><Money value={balance.bonusesInPeriod} /></p>
            </div>
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.advancesLabel}</p>
              <p className="text-[1.0625rem] font-bold"><Money value={balance.advancesInPeriod} /></p>
            </div>
          </div>
        </SpringCard>

        <div className="flex gap-1.5">
          {(["week", "month"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGranularity(g);
                setAnchor(new Date());
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold",
                granularity === g ? "bg-primary/10 text-primary" : "bg-card text-muted-foreground"
              )}
            >
              {g === "week" ? t.money.periodWeek : t.money.periodMonth}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label={t.money.prevPeriod}
            onClick={() => stepPeriod(-1)}
            className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
          >
            <ChevronLeft className="size-4.5" />
          </button>
          <p className="text-caption-airbnb font-semibold text-foreground">{formatPeriodLabel()}</p>
          <button
            type="button"
            aria-label={t.money.nextPeriod}
            onClick={() => stepPeriod(1)}
            disabled={isCurrentPeriod()}
            className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
          >
            <ChevronRight className="size-4.5" />
          </button>
        </div>

        {timeTrackingMode === "manual" && (
          <PressableScale>
            <Button onClick={openForm} className="h-14 w-full gap-2 rounded-control font-bold">
              <Plus className="size-5" />
              {t.operatorApp.workTime.addShiftButton}
            </Button>
          </PressableScale>
        )}
        {/* Auto-режим: аванс/премия вводятся не вместе с формой смены (её нет),
            а отдельной кнопкой — доступна, только пока смена открыта (см.
            /api/operator/work-time/advance-request, 409 без открытой смены). */}
        {timeTrackingMode === "auto" && (
          <PressableScale>
            <Button
              onClick={openAdvanceRequest}
              variant="secondary"
              className="h-14 w-full gap-2 rounded-control font-bold"
            >
              <Plus className="size-5" />
              {t.operatorApp.workTime.requestAdvanceButton}
            </Button>
          </PressableScale>
        )}

        <div className="flex flex-col gap-2">
          {historyItems.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.workTime.noShifts}</p>
          ) : (
            historyItems.map((item) =>
              item.kind === "shift" ? (
                <SpringCard key={`shift-${item.shift.id}`} hover={false} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-body-airbnb font-bold">{formatShiftDate(item.shift.startAt)}</span>
                    <span className="text-body-airbnb font-bold tabular-nums"><Money value={item.shift.accrued} /></span>
                  </div>
                  <span className="tabular-nums text-caption-airbnb">
                    {formatTime(item.shift.startAt)}–{formatTime(item.shift.endAt)} · {formatDuration(item.shift.minutes)}
                  </span>
                  {(item.shift.advanceAmount > 0 || item.shift.bonusAmount > 0) && (
                    <div className="flex gap-3 text-xs tabular-nums">
                      {item.shift.advanceAmount > 0 && (
                        <span className="text-warning">
                          {t.operatorApp.workTime.advanceInline} <Money value={item.shift.advanceAmount} />
                        </span>
                      )}
                      {item.shift.bonusAmount > 0 && (
                        <span className="text-success">
                          {t.operatorApp.workTime.bonusInline} <Money value={item.shift.bonusAmount} />
                        </span>
                      )}
                    </div>
                  )}
                </SpringCard>
              ) : (
                <SpringCard key={`op-${item.op.id}`} hover={false} className="flex flex-row items-center justify-between">
                  <span className="text-body-airbnb font-bold">
                    {formatShiftDate(item.op.occurredAt)} ·{" "}
                    {item.op.type === "advance" ? t.operatorApp.workTime.advanceFieldLabel : t.operatorApp.workTime.bonusFieldLabel}
                  </span>
                  <span
                    className={cn(
                      "text-body-airbnb font-bold tabular-nums",
                      item.op.type === "advance" ? "text-warning" : "text-success"
                    )}
                  >
                    <Money value={item.op.amount} />
                  </span>
                </SpringCard>
              )
            )
          )}
        </div>
      </div>

      <BottomSheet open={formOpen} onClose={() => setFormOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.workTime.addShiftTitle}</h2>

          <div className="flex items-center justify-around gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <Label>{t.operatorApp.workTime.arrivedLabel}</Label>
              <WheelTimePicker
                hour={startHour}
                minute={startMinute}
                hourValues={allowedStartHours(defaultShiftStartTime, earlyToleranceMinutes, lateToleranceMinutes)}
                onChange={(v) => {
                  setStartHour(v.hour);
                  setStartMinute(v.minute);
                }}
              />
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <Label>{t.operatorApp.workTime.leftLabel}</Label>
              <WheelTimePicker
                hour={endHour}
                minute={endMinute}
                onChange={(v) => {
                  setEndHour(v.hour);
                  setEndMinute(v.minute);
                }}
              />
            </div>
          </div>

          <div className="flex items-stretch gap-2">
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="advanceInput">{t.operatorApp.workTime.advanceFieldLabel}</Label>
                <MoneyInput
                  id="advanceInput"
                  scale="lg"
                  className="h-14 text-lg"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="bonusInput">{t.operatorApp.workTime.bonusFieldLabel}</Label>
                <MoneyInput
                  id="bonusInput"
                  scale="lg"
                  className="h-14 text-lg"
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <PressableScale className="flex">
              <SaveButton
                onClick={handleSubmitShift}
                disabled={submitting}
                saved={shiftSaved}
                className="h-full min-w-22 rounded-control px-5 font-bold"
              />
            </PressableScale>
          </div>

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
        </div>
      </BottomSheet>

      <BottomSheet open={advanceRequestOpen} onClose={() => setAdvanceRequestOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {t.operatorApp.workTime.requestAdvanceTitle}
          </h2>

          <div className="flex items-stretch gap-2">
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="advanceRequestInput">{t.operatorApp.workTime.advanceFieldLabel}</Label>
                <MoneyInput
                  id="advanceRequestInput"
                  scale="lg"
                  className="h-14 text-lg"
                  value={advanceRequestAmount}
                  onChange={(e) => setAdvanceRequestAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="bonusRequestInput">{t.operatorApp.workTime.bonusFieldLabel}</Label>
                <MoneyInput
                  id="bonusRequestInput"
                  scale="lg"
                  className="h-14 text-lg"
                  value={bonusRequestAmount}
                  onChange={(e) => setBonusRequestAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <PressableScale className="flex">
              <SaveButton
                onClick={submitAdvanceRequest}
                disabled={advanceRequestSubmitting}
                saved={advanceRequestSaved}
                className="h-full min-w-22 rounded-control px-5 font-bold"
              />
            </PressableScale>
          </div>

          {advanceRequestError && <p className="text-sm text-destructive">{advanceRequestError}</p>}
        </div>
      </BottomSheet>
    </div>
  );
}
