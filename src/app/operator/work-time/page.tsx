"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { WheelTimePicker } from "@/components/wheel-time-picker";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

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

type PeriodGranularity = "week" | "month";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toDateStr(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
// Локальное время устройства — то, что оператор реально видит на часах,
// а не UTC-час хранения (см. handleSubmitShift ниже: смена конструируется
// из локальных компонент, а не Date.UTC, чтобы округлять туда-обратно
// без сдвига на часовой пояс).
function formatTime(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  const [formOpen, setFormOpen] = useState(false);
  const [startHour, setStartHour] = useState(9);
  const [startMinute, setStartMinute] = useState(0);
  const [endHour, setEndHour] = useState(18);
  const [endMinute, setEndMinute] = useState(0);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [notice, setNotice] = useState<{ warnings: string[]; noResultsToday: boolean } | null>(null);

  function periodRange(): { from: string; to: string } {
    const a = new Date(anchor);
    if (granularity === "week") {
      const dayIndex = (a.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() - dayIndex));
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      return { from: toDateStr(start), to: toDateStr(end) };
    }
    const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
    const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0));
    return { from: toDateStr(start), to: toDateStr(end) };
  }

  async function loadData() {
    const { from, to } = periodRange();
    const [summaryRes, shiftsRes] = await Promise.all([
      fetch(`/api/operator/work-time/summary?from=${from}&to=${to}`),
      fetch(`/api/operator/work-time/shifts?from=${from}&to=${to}`),
    ]);
    if (summaryRes.status === 401 || shiftsRes.status === 401) {
      router.replace("/operator/login");
      return;
    }
    if (summaryRes.status === 403 || shiftsRes.status === 403) {
      router.replace("/operator");
      return;
    }
    const summaryData = await summaryRes.json();
    setBalance(summaryData);
    setDefaultShiftStartTime(summaryData.defaultShiftStartTime ?? "10:00");
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
    const today = new Date();
    if (granularity === "week") {
      const weekStart = (d: Date) => {
        const day = (d.getUTCDay() + 6) % 7;
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
      };
      return weekStart(anchor) === weekStart(today);
    }
    return anchor.getUTCFullYear() === today.getUTCFullYear() && anchor.getUTCMonth() === today.getUTCMonth();
  }

  function stepPeriod(delta: number) {
    if (delta > 0 && isCurrentPeriod()) return;
    const next = new Date(anchor);
    if (granularity === "week") next.setUTCDate(next.getUTCDate() + delta * 7);
    else next.setUTCMonth(next.getUTCMonth() + delta);
    setAnchor(next);
  }

  function formatPeriodLabel() {
    if (granularity === "week") {
      const dayIndex = (anchor.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - dayIndex));
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      return `${start.getUTCDate()}–${end.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]}`;
    }
    return `${t.readings.months[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
  }

  function openForm() {
    // "Пришёл" по умолчанию — время из настроек владельца (Settings ->
    // Рабочее время), было зашито как 10:00, теперь настраиваемо; "ушёл" —
    // реальное текущее время устройства/браузера, а не фиксированное
    // значение, чтобы форма сразу отражала "я ухожу прямо сейчас".
    const [defaultHour, defaultMinute] = defaultShiftStartTime.split(":").map(Number);
    const now = new Date();
    setStartHour(defaultHour);
    setStartMinute(defaultMinute);
    setEndHour(now.getHours());
    setEndMinute(now.getMinutes());
    setAdvanceAmount("");
    setBonusAmount("");
    setSubmitError(null);
    setFormOpen(true);
  }

  const searchParams = useSearchParams();
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // "Добавить смену" с главного экрана (?add=1) — сразу открыть форму, не
    // заставляя оператора ещё раз тапать по кнопке на этой странице.
    if (!checking && searchParams.get("add") === "1") {
      openForm();
      router.replace("/operator/work-time");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking]);
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
      setFormOpen(false);
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

  function formatDuration(minutes: number) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m
      ? `${h} ${t.operatorApp.workTime.hoursShort} ${m} ${t.operatorApp.workTime.minutesShort}`
      : `${h} ${t.operatorApp.workTime.hoursShort}`;
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
      <div className="flex w-full max-w-md flex-col gap-4">
        <Link href="/operator" className="w-fit text-caption-airbnb font-semibold text-primary">
          ← {t.common.back}
        </Link>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{t.operatorApp.workTime.title}</h1>

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
                "text-[34px] font-extrabold tabular-nums tracking-[-0.02em]",
                balance.toPayOut < 0 && "text-destructive"
              )}
            >
              {balance.toPayOut.toFixed(2)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3.5 tabular-nums">
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.earnedLabel}</p>
              <p className="text-[17px] font-bold">{balance.earnedInPeriod.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.rateAccruedLabel}</p>
              <p className="text-[17px] font-bold">{balance.rateEarnedInPeriod.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.bonusesLabel}</p>
              <p className="text-[17px] font-bold">{balance.bonusesInPeriod.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-caption-airbnb">{t.operatorApp.workTime.advancesLabel}</p>
              <p className="text-[17px] font-bold">{balance.advancesInPeriod.toFixed(2)}</p>
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

        <PressableScale>
          <Button onClick={openForm} className="h-14 w-full gap-2 rounded-control font-bold">
            <Plus className="size-5" />
            {t.operatorApp.workTime.addShiftButton}
          </Button>
        </PressableScale>

        <div className="flex flex-col gap-2">
          {historyItems.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.workTime.noShifts}</p>
          ) : (
            historyItems.map((item) =>
              item.kind === "shift" ? (
                <SpringCard key={`shift-${item.shift.id}`} hover={false} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-body-airbnb font-bold">{formatShiftDate(item.shift.startAt)}</span>
                    <span className="text-body-airbnb font-bold tabular-nums">{item.shift.accrued.toFixed(2)}</span>
                  </div>
                  <span className="tabular-nums text-caption-airbnb">
                    {formatTime(item.shift.startAt)}–{formatTime(item.shift.endAt)} · {formatDuration(item.shift.minutes)}
                  </span>
                  {(item.shift.advanceAmount > 0 || item.shift.bonusAmount > 0) && (
                    <div className="flex gap-3 text-xs tabular-nums">
                      {item.shift.advanceAmount > 0 && (
                        <span className="text-warning">
                          {t.operatorApp.workTime.advanceInline} {item.shift.advanceAmount.toFixed(2)}
                        </span>
                      )}
                      {item.shift.bonusAmount > 0 && (
                        <span className="text-success">
                          {t.operatorApp.workTime.bonusInline} {item.shift.bonusAmount.toFixed(2)}
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
                    {item.op.amount.toFixed(2)}
                  </span>
                </SpringCard>
              )
            )
          )}
        </div>
      </div>

      <BottomSheet open={formOpen} onClose={() => setFormOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operatorApp.workTime.addShiftTitle}</h2>

          <div className="flex items-center justify-around gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <Label>{t.operatorApp.workTime.arrivedLabel}</Label>
              <WheelTimePicker
                hour={startHour}
                minute={startMinute}
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

          <div className="flex flex-col gap-1">
            <Label htmlFor="advanceInput">{t.operatorApp.workTime.advanceFieldLabel}</Label>
            <Input
              id="advanceInput"
              inputMode="decimal"
              className="h-14 text-lg tabular-nums"
              value={advanceAmount}
              onChange={(e) => setAdvanceAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bonusInput">{t.operatorApp.workTime.bonusFieldLabel}</Label>
            <Input
              id="bonusInput"
              inputMode="decimal"
              className="h-14 text-lg tabular-nums"
              value={bonusAmount}
              onChange={(e) => setBonusAmount(e.target.value)}
              placeholder="0"
            />
          </div>

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}

          <PressableScale>
            <Button onClick={handleSubmitShift} disabled={submitting} className="h-14 w-full rounded-control font-bold">
              {submitting ? t.operatorApp.submit.submitting : t.operatorApp.workTime.saveShiftButton}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>
    </div>
  );
}
