"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { TimeInput } from "@/components/time-input";
import { Label } from "@/components/ui/label";
import { SpringCard } from "@/components/spring-card";
import { StatusChip } from "@/components/status-chip";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { useI18n } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { formatTime } from "@/lib/datetime-format";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface LaunchRow {
  id: string;
  zoneId: string;
  zoneName: string;
  assetName: string | null;
  number: number;
  label: string | null;
  startedAt: string;
  endedAt: string | null;
  amount: number | null;
  voidedAt: string | null;
}

export default function LaunchesListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useI18n();
  const zoneId = searchParams.get("zoneId");

  const [checking, setChecking] = useState(true);
  const [month, setMonth] = useState(() => new Date());
  const [launches, setLaunches] = useState<LaunchRow[]>([]);
  const showZoneName = !zoneId;

  const [kebabFor, setKebabFor] = useState<LaunchRow | null>(null);
  const [kebabView, setKebabView] = useState<"menu" | "edit" | "confirm-void">("menu");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const { saved: editSaved, pulse: editPulse } = useSavePulse();
  const { saved: voided, pulse: voidPulse } = useSavePulse();
  const [voiding, setVoiding] = useState(false);

  function isCurrentMonth() {
    const today = new Date();
    return month.getUTCFullYear() === today.getUTCFullYear() && month.getUTCMonth() === today.getUTCMonth();
  }

  function stepMonth(delta: number) {
    if (delta > 0 && isCurrentMonth()) return;
    const next = new Date(month);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setMonth(next);
  }

  function load() {
    const year = month.getUTCFullYear();
    const m = month.getUTCMonth() + 1;
    const query = new URLSearchParams({ year: String(year), month: String(m) });
    if (zoneId) query.set("zoneId", zoneId);
    fetch(`/api/launches?${query}`)
      .then((res) => (res.status === 401 ? null : res.ok ? res.json() : { launches: [] }))
      .then((data) => {
        if (data === null) {
          router.replace("/login");
          return;
        }
        setLaunches(data.launches ?? []);
        setChecking(false);
      });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, zoneId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function formatGroupDate(dateStr: string) {
    const d = new Date(dateStr);
    return `${d.getUTCDate()} ${t.readings.monthsGenitive[d.getUTCMonth()]}`;
  }

  const groups: { date: string; items: LaunchRow[] }[] = [];
  for (const l of launches) {
    const dateKey = l.startedAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === dateKey) last.items.push(l);
    else groups.push({ date: dateKey, items: [l] });
  }

  function openKebab(l: LaunchRow) {
    setKebabFor(l);
    setKebabView("menu");
    setActionError(null);
    setEditStart(formatTime(l.startedAt).slice(0, 5));
    setEditEnd(l.endedAt ? formatTime(l.endedAt).slice(0, 5) : "");
  }

  function combineDateTime(original: string, hhmm: string): string {
    const d = new Date(original);
    const [h, m] = hhmm.split(":").map(Number);
    d.setUTCHours(h, m, 0, 0);
    return d.toISOString();
  }

  async function submitEdit() {
    if (!kebabFor) return;
    setActionError(null);
    const body: { startedAt?: string; endedAt?: string | null } = {
      startedAt: combineDateTime(kebabFor.startedAt, editStart),
    };
    if (kebabFor.endedAt) body.endedAt = combineDateTime(kebabFor.endedAt, editEnd);
    const res = await fetch(`/api/launches/${kebabFor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? t.zoneDetail.gameRoomSaveError);
      return;
    }
    load();
    editPulse(() => setKebabFor(null));
  }

  async function confirmVoid() {
    if (!kebabFor) return;
    setVoiding(true);
    setActionError(null);
    const res = await fetch(`/api/launches/${kebabFor.id}/void`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? t.zoneDetail.gameRoomSaveError);
      setVoiding(false);
      return;
    }
    setVoiding(false);
    load();
    voidPulse(() => setKebabFor(null));
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
          <Link href="/" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.nav.home}
          </Link>
          <h1 className="text-screen-title">{t.zoneDetail.gameRoomLaunchesListLink}</h1>

          <SpringCard hover={false} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label={t.readings.prevMonth}
                onClick={() => stepMonth(-1)}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
              >
                <ChevronLeft className="size-4.5" />
              </button>
              <p className="text-card-title">
                {t.readings.months[month.getUTCMonth()]} {month.getUTCFullYear()}
              </p>
              <button
                type="button"
                aria-label={t.readings.nextMonth}
                onClick={() => stepMonth(1)}
                disabled={isCurrentMonth()}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4.5" />
              </button>
            </div>

            {groups.length === 0 ? (
              <p className="text-caption-airbnb text-muted-foreground">{t.operatorApp.gameRoom.emptyState}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {groups.map((group) => (
                  <div key={group.date}>
                    <p className="mb-1 text-caption-airbnb font-semibold text-muted-foreground">
                      {formatGroupDate(group.date)}
                    </p>
                    <div className="flex flex-col">
                      {group.items.map((l) => (
                        <div
                          key={l.id}
                          className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-t-0"
                        >
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            {formatTime(l.startedAt)} · {t.operatorApp.gameRoom.launchNumberPrefix} {l.number}
                            {l.assetName ? ` · ${l.assetName}` : ""}
                            {showZoneName ? ` (${l.zoneName})` : ""}
                            {l.voidedAt && (
                              <span className="ml-1">
                                <StatusChip variant="neutral">{t.money.voidedChip}</StatusChip>
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="text-xs font-bold tabular-nums">
                              {l.amount != null && <Money value={l.amount} />}
                            </span>
                            {!l.voidedAt && (
                              <KebabButton onClick={() => openKebab(l)} label={t.operatorApp.gameRoom.launchActionsLabel} />
                            )}
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

      <BottomSheet open={kebabFor !== null} onClose={() => setKebabFor(null)}>
        {kebabFor && kebabView === "menu" && (
          <div className="flex flex-col pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.operatorApp.gameRoom.launchNumberPrefix} {kebabFor.number}
            </h2>
            <ActionSheetItem icon={Pencil} onClick={() => setKebabView("edit")}>
              {t.common.edit}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setKebabView("confirm-void")}>
              {t.money.voidAction}
            </ActionSheetItem>
          </div>
        )}
        {kebabFor && kebabView === "edit" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.common.edit}</h2>
            <div className="flex flex-col gap-1">
              <Label>{t.operatorApp.gameRoom.startTimeLabel}</Label>
              <TimeInput value={editStart} onChange={(e) => setEditStart(e.target.value)} />
            </div>
            {kebabFor.endedAt && (
              <div className="flex flex-col gap-1">
                <Label>{t.operatorApp.gameRoom.endTimeLabel}</Label>
                <TimeInput value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
              </div>
            )}
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <PressableScale>
              <SaveButton className="h-12 w-full" onClick={submitEdit} saved={editSaved} />
            </PressableScale>
          </div>
        )}
        {kebabFor && kebabView === "confirm-void" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.money.voidAction}</h2>
            <p className="text-body-airbnb">{t.money.voidConfirm}</p>
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <PressableScale>
              <DeleteButton className="h-12 w-full" disabled={voiding} onClick={confirmVoid} deleted={voided} />
            </PressableScale>
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}
