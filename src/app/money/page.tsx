"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Gift, Wallet } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { pad, toDateStr } from "@/lib/datetime-format";

type Granularity = "day" | "week" | "month" | "year";

interface Report {
  business: { revenue: number; expense: number; profit: number };
}

export default function MoneyPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [report, setReport] = useState<Report | null>(null);

  const [mode, setMode] = useState<"granularity" | "custom">("granularity");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [customFrom, setCustomFrom] = useState(() => toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(() => toDateStr(new Date()));

  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [dayRevenue, setDayRevenue] = useState<Record<string, number>>({});
  const [pickDateOpen, setPickDateOpen] = useState(false);

  async function loadCalendar() {
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth() + 1;
    const res = await fetch(`/api/reports/money/calendar?year=${year}&month=${month}`);
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setDayRevenue(data.dayRevenue ?? {});
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function isCalendarCurrentMonth() {
    const today = new Date();
    return (
      calendarMonth.getUTCFullYear() === today.getUTCFullYear() && calendarMonth.getUTCMonth() === today.getUTCMonth()
    );
  }

  function stepCalendarMonth(delta: number) {
    if (delta > 0 && isCalendarCurrentMonth()) return;
    const next = new Date(calendarMonth);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setCalendarMonth(next);
  }

  function selectCalendarDate(dateStr: string) {
    setGranularity("day");
    setAnchor(new Date(`${dateStr}T00:00:00.000Z`));
    setMode("granularity");
    setPickDateOpen(false);
  }

  async function loadReport() {
    const url =
      mode === "custom"
        ? `/api/reports/money?from=${customFrom}&to=${customTo}`
        : `/api/reports/money?granularity=${granularity}&anchor=${toDateStr(anchor)}`;
    const res = await fetch(url);
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    setReport(await res.json());
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, granularity, anchor, customFrom, customTo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function isCurrentPeriod() {
    const today = new Date();
    if (granularity === "year") return anchor.getUTCFullYear() === today.getUTCFullYear();
    if (granularity === "month") {
      return anchor.getUTCFullYear() === today.getUTCFullYear() && anchor.getUTCMonth() === today.getUTCMonth();
    }
    if (granularity === "day") {
      return toDateStr(anchor) === toDateStr(today);
    }
    const weekStart = (d: Date) => {
      const day = (d.getUTCDay() + 6) % 7;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
    };
    return weekStart(anchor) === weekStart(today);
  }

  function stepPeriod(delta: number) {
    if (delta > 0 && isCurrentPeriod()) return;
    const next = new Date(anchor);
    if (granularity === "day") next.setUTCDate(next.getUTCDate() + delta);
    else if (granularity === "week") next.setUTCDate(next.getUTCDate() + delta * 7);
    else if (granularity === "month") next.setUTCMonth(next.getUTCMonth() + delta);
    else next.setUTCFullYear(next.getUTCFullYear() + delta);
    setAnchor(next);
  }

  function formatPeriodLabel() {
    if (granularity === "year") return String(anchor.getUTCFullYear());
    if (granularity === "month") return `${t.readings.months[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
    if (granularity === "day") {
      return `${anchor.getUTCDate()} ${t.readings.monthsGenitive[anchor.getUTCMonth()]} (${t.readings.weekdaysFull[(anchor.getUTCDay() + 6) % 7]})`;
    }
    const day = (anchor.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - day));
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    return sameMonth
      ? `${start.getUTCDate()}–${end.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]}`
      : `${start.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]} – ${end.getUTCDate()} ${t.readings.monthsGenitive[end.getUTCMonth()]}`;
  }

  if (checking || !report) return null;

  // Тот же приём компактного календаря, что в /money/readings — не
  // показываем ячейки будущих дней, текущий месяц обрезан сегодняшним числом.
  const calYear = calendarMonth.getUTCFullYear();
  const calMonth = calendarMonth.getUTCMonth() + 1;
  const today = new Date();
  const todayKey = toDateStr(today);
  const daysInCalMonth = new Date(Date.UTC(calYear, calMonth, 0)).getUTCDate();
  const calFirstWeekdayIndex = (new Date(Date.UTC(calYear, calMonth - 1, 1)).getUTCDay() + 6) % 7;
  const isCalFutureMonth =
    calYear > today.getUTCFullYear() || (calYear === today.getUTCFullYear() && calMonth > today.getUTCMonth() + 1);
  const calLastVisibleDay = isCalFutureMonth ? 0 : isCalendarCurrentMonth() ? today.getUTCDate() : daysInCalMonth;
  const calCells: (string | null)[] = [
    ...Array(calFirstWeekdayIndex).fill(null),
    ...Array.from({ length: calLastVisibleDay }, (_, i) => `${calYear}-${pad(calMonth)}-${pad(i + 1)}`),
  ];
  const selectedCalDate = granularity === "day" ? toDateStr(anchor) : null;

  function formatCellAmount(amount: number) {
    return amount >= 1000 ? `${Math.round(amount / 1000)}k` : String(Math.round(amount));
  }

  function renderCalendarGrid() {
    return (
      <div className="grid grid-cols-7 gap-1 text-center">
        {t.readings.weekdays.map((w) => (
          <span key={w} className="text-caption-airbnb font-semibold">
            {w}
          </span>
        ))}
        {calCells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;
          const revenue = dayRevenue[date];
          const active = revenue !== undefined && revenue > 0;
          const day = Number(date.slice(-2));
          return (
            <button
              key={date}
              type="button"
              disabled={!active}
              onClick={() => selectCalendarDate(date)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 rounded-control py-1.5 tabular-nums",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground/60",
                date === todayKey && !active && "text-foreground",
                date === selectedCalDate && active && "ring-2 ring-primary ring-offset-1 ring-offset-card"
              )}
            >
              <span className="text-[12.5px] font-semibold">{day}</span>
              {active && <span className="text-[9px] font-medium leading-none">{formatCellAmount(revenue)}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-3.5">
          <h1 className="text-screen-title">{t.money.title}</h1>

          <div className="grid grid-cols-5 gap-1">
            {(["day", "week", "month", "year"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGranularity(g);
                  setAnchor(new Date());
                  setMode("granularity");
                }}
                className={cn(
                  "rounded-full px-1 py-1.5 text-center text-[11px] font-semibold sm:text-xs",
                  mode === "granularity" && g === granularity
                    ? "bg-primary/10 text-primary"
                    : "bg-surface-0 text-muted-foreground"
                )}
              >
                {g === "day"
                  ? t.money.periodDay
                  : g === "week"
                    ? t.money.periodWeek
                    : g === "month"
                      ? t.money.periodMonth
                      : t.money.periodYear}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={cn(
                "rounded-full px-1 py-1.5 text-center text-[11px] font-semibold sm:text-xs",
                mode === "custom" ? "bg-primary/10 text-primary" : "bg-surface-0 text-muted-foreground"
              )}
            >
              {t.money.periodCustom}
            </button>
          </div>

          {mode === "granularity" ? (
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label={t.money.prevPeriod}
                onClick={() => stepPeriod(-1)}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
              >
                <ChevronLeft className="size-4.5" />
              </button>
              {granularity === "day" ? (
                <button
                  type="button"
                  onClick={() => {
                    setCalendarMonth(new Date(anchor));
                    setPickDateOpen(true);
                  }}
                  className="flex items-center gap-1.5 text-caption-airbnb font-semibold text-primary"
                >
                  <CalendarIcon className="size-3.5" />
                  {formatPeriodLabel()}
                </button>
              ) : (
                <p className="text-caption-airbnb font-semibold text-foreground">{formatPeriodLabel()}</p>
              )}
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
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
              />
              <span className="text-caption-airbnb text-muted-foreground">—</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={toDateStr(new Date())}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
              />
            </div>
          )}

          <SpringCard hover={false} className="flex flex-col gap-4">
            <h2 className="text-section-title">{t.money.businessTitle}</h2>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-[34px] font-extrabold tracking-[-0.02em]">
                {report.business.profit.toFixed(2)}
              </span>
              <span className="text-body-airbnb text-muted-foreground">{t.money.profit}</span>
            </div>
            <div className="flex border-t border-border pt-3.5 tabular-nums">
              <div className="flex-1">
                <p className="text-caption-airbnb">{t.money.revenue}</p>
                <p className="text-[17px] font-bold">{report.business.revenue.toFixed(2)}</p>
              </div>
              <div className="flex-1 border-l border-border pl-4">
                <p className="text-caption-airbnb">{t.money.expense}</p>
                <p className="text-[17px] font-bold">{report.business.expense.toFixed(2)}</p>
                <p className="text-[10.5px] leading-tight text-muted-foreground">{t.money.expenseHint}</p>
              </div>
              <div className="flex-1 border-l border-border pl-4">
                <p className="text-caption-airbnb">{t.money.profit}</p>
                <p className="text-[17px] font-bold text-primary">+{report.business.profit.toFixed(2)}</p>
              </div>
            </div>
          </SpringCard>

          <PressableScale>
            <Link href="/money/zone-balances">
              <SpringCard className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                  <Building2 className="size-5" />
                </div>
                <div className="min-w-0 grow">
                  <p className="text-card-title">{t.money.zoneBalancesLink}</p>
                  <p className="text-caption-airbnb">{t.money.zoneBalancesLinkHint}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </SpringCard>
            </Link>
          </PressableScale>

          <PressableScale>
            <Link href="/money/collections">
              <SpringCard className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                  <Wallet className="size-5" />
                </div>
                <div className="min-w-0 grow">
                  <p className="text-card-title">{t.money.collectionsLink}</p>
                  <p className="text-caption-airbnb">{t.money.collectionsLinkHint}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </SpringCard>
            </Link>
          </PressableScale>

          <PressableScale>
            <Link href="/money/advances-bonuses">
              <SpringCard className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                  <Gift className="size-5" />
                </div>
                <div className="min-w-0 grow">
                  <p className="text-card-title">{t.money.advancesBonusesLink}</p>
                  <p className="text-caption-airbnb">{t.money.advancesBonusesLinkHint}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </SpringCard>
            </Link>
          </PressableScale>
        </div>
      </div>

      <BottomSheet open={pickDateOpen} onClose={() => setPickDateOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.money.pickDateTitle}</h2>
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label={t.readings.prevMonth}
              onClick={() => stepCalendarMonth(-1)}
              className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
            >
              <ChevronLeft className="size-4.5" />
            </button>
            <p className="text-card-title">
              {t.readings.months[calMonth - 1]} {calYear}
            </p>
            <button
              type="button"
              aria-label={t.readings.nextMonth}
              onClick={() => stepCalendarMonth(1)}
              disabled={isCalendarCurrentMonth()}
              className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4.5" />
            </button>
          </div>
          {renderCalendarGrid()}
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
