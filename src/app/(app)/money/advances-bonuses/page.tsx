"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/datetime-format";
import { Money } from "@/components/money";

interface AdvanceBonusEntry {
  id: string;
  occurredAt: string;
  type: "advance" | "bonus_payout";
  amount: number;
  pointName: string;
  operatorName: string | null;
}

export default function AdvancesBonusesRegisterPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [advancesBonuses, setAdvancesBonuses] = useState<AdvanceBonusEntry[]>([]);
  const [showPointName, setShowPointName] = useState(false);

  async function loadAdvancesBonuses() {
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth() + 1;
    const res = await fetch(`/api/reports/money/advances-bonuses?year=${year}&month=${month}`);
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setAdvancesBonuses(data.entries ?? []);
    setShowPointName(!!data.showPointName);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadAdvancesBonuses();
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

  function formatGroupDate(dateStr: string) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return `${d.getUTCDate()} ${t.readings.monthsGenitive[d.getUTCMonth()]}`;
  }


  const advanceBonusGroups: { date: string; items: AdvanceBonusEntry[] }[] = [];
  for (const op of advancesBonuses) {
    const dateKey = op.occurredAt.slice(0, 10);
    const lastGroup = advanceBonusGroups[advanceBonusGroups.length - 1];
    if (lastGroup && lastGroup.date === dateKey) lastGroup.items.push(op);
    else advanceBonusGroups.push({ date: dateKey, items: [op] });
  }

  if (checking) return null;

  const calYear = calendarMonth.getUTCFullYear();
  const calMonth = calendarMonth.getUTCMonth() + 1;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-3.5">
          <Link href="/money" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.money.title}
          </Link>
          <h1 className="text-screen-title">{t.money.advancesBonusesRegisterTitle}</h1>

          <SpringCard hover={false} className="flex flex-col gap-3">
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
            {advanceBonusGroups.length === 0 ? (
              <p className="text-caption-airbnb text-muted-foreground">{t.money.noAdvancesBonuses}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {advanceBonusGroups.map((group) => (
                  <div key={group.date}>
                    <p className="mb-1 text-caption-airbnb font-semibold text-muted-foreground">
                      {formatGroupDate(group.date)}
                    </p>
                    <div className="flex flex-col">
                      {group.items.map((op) => (
                        <div
                          key={op.id}
                          className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
                        >
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            {formatTime(op.occurredAt)} ·{" "}
                            {op.type === "advance"
                              ? t.operatorApp.workTime.advanceFieldLabel
                              : t.operatorApp.workTime.bonusFieldLabel}
                            {op.operatorName ? ` · ${op.operatorName}` : ""}
                            {showPointName ? ` (${op.pointName})` : ""}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-xs font-bold tabular-nums",
                              op.type === "advance" ? "text-warning" : "text-success"
                            )}
                          >
                            <Money value={op.amount} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SpringCard>
        </div>
      </div>
    </OwnerShell>
  );
}
