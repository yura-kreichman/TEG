"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Info, MapPin, Pencil, Trash2 } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { ZoneAccountingMode } from "@/lib/results-calc";
import { formatTime, pad } from "@/lib/datetime-format";

interface PointOption {
  id: string;
  name: string;
  iconKey: string | null;
}

interface DayAssetReading {
  tariffId: string;
  tariffName: string;
  previousValue: number | null;
  value: number;
  sessions: number;
  editedBefore: number | null;
}

interface DayCard {
  zoneSubmissionId: string;
  zoneId: string;
  zoneName: string;
  accountingMode: ZoneAccountingMode;
  submittedAt: string;
  operatorName: string;
  editable: boolean;
  edited: { at: string; reason: string | null } | null;
  cashAmount: number;
  cashEditedBefore: number | null;
  mobileAmount: number;
  returnsCount: number;
  calculatedRevenue: number;
  difference: number;
  assets: {
    assetId: string;
    assetName: string;
    colorTag: string;
    photoUrl: string | null;
    iconKey: string | null;
    readings: DayAssetReading[];
  }[];
}


type ActionsView = "menu" | "edit" | "confirm-delete";

export default function ReadingsCalendarPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [points, setPoints] = useState<PointOption[]>([]);
  const [pointId, setPointId] = useState<string | null>(null);

  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth() + 1); // 1-12

  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [cards, setCards] = useState<DayCard[] | null>(null);

  const [actionsFor, setActionsFor] = useState<DayCard | null>(null);
  const [actionsView, setActionsView] = useState<ActionsView>("menu");
  const [editReadings, setEditReadings] = useState<Record<string, string>>({});
  const [editCash, setEditCash] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [editReturns, setEditReturns] = useState("");
  const [editReason, setEditReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadPoints() {
    const res = await fetch("/api/points");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    const list: PointOption[] = data.points ?? [];
    setPoints(list);
    setPointId((prev) => prev ?? list[0]?.id ?? null);
    setChecking(false);
  }

  async function loadCalendar() {
    if (!pointId) return;
    const res = await fetch(`/api/reports/counters/calendar?pointId=${pointId}&year=${year}&month=${month}`);
    if (!res.ok) return;
    const data = await res.json();
    setActiveDates(new Set<string>(data.activeDates ?? []));
  }

  async function loadDay(date: string) {
    if (!pointId) return;
    const res = await fetch(`/api/reports/counters/day?pointId=${pointId}&date=${date}`);
    if (!res.ok) return;
    const data = await res.json();
    setCards(data.cards ?? []);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, year, month]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openDay(date: string) {
    setSelectedDate(date);
    setCards(null);
    loadDay(date);
  }

  function goMonth(delta: number) {
    if (delta > 0 && year === today.getUTCFullYear() && month === today.getUTCMonth() + 1) return;
    let nextMonth = month + delta;
    let nextYear = year;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setMonth(nextMonth);
    setYear(nextYear);
  }

  function openActions(card: DayCard) {
    setActionsFor(card);
    setActionsView("menu");
    setActionError(null);
  }

  function openEdit() {
    if (!actionsFor) return;
    const readings: Record<string, string> = {};
    for (const asset of actionsFor.assets) {
      for (const r of asset.readings) readings[`${asset.assetId}:${r.tariffId}`] = String(r.value);
    }
    setEditReadings(readings);
    setEditCash(String(actionsFor.cashAmount));
    setEditMobile(String(actionsFor.mobileAmount));
    setEditReturns(String(actionsFor.returnsCount));
    setEditReason("");
    setActionError(null);
    setActionsView("edit");
  }

  async function confirmEdit() {
    if (!actionsFor) return;
    const res = await fetch(`/api/reports/counters/zone-submission/${actionsFor.zoneSubmissionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        readings: Object.fromEntries(Object.entries(editReadings).map(([k, v]) => [k, Number(v)])),
        cashAmount: Number(editCash || 0),
        mobileAmount: Number(editMobile || 0),
        returnsCount: Number(editReturns || 0),
        reason: editReason,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? t.readings.saveError);
      return;
    }
    setActionsFor(null);
    if (selectedDate) await loadDay(selectedDate);
  }

  async function confirmDelete() {
    if (!actionsFor || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reports/counters/zone-submission/${actionsFor.zoneSubmissionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setActionError(data?.error ?? t.readings.deleteError);
        return;
      }
      setActionsFor(null);
      if (selectedDate) await loadDay(selectedDate);
      await loadCalendar();
    } finally {
      setDeleting(false);
    }
  }

  if (checking) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekdayIndex = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // 0=Mon
  const todayKey = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;

  // Compact calendar: no point showing empty future days, so the grid never
  // extends past today (and the current month is as far forward as nav goes).
  const isCurrentMonth = year === today.getUTCFullYear() && month === today.getUTCMonth() + 1;
  const isFutureMonth =
    year > today.getUTCFullYear() || (year === today.getUTCFullYear() && month > today.getUTCMonth() + 1);
  const lastVisibleDay = isFutureMonth ? 0 : isCurrentMonth ? today.getUTCDate() : daysInMonth;

  const cells: (string | null)[] = [
    ...Array(firstWeekdayIndex).fill(null),
    ...Array.from({ length: lastVisibleDay }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`),
  ];

  function formatReadableDate(dateStr: string) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const day = d.getUTCDate();
    const monthName = t.readings.monthsGenitive[d.getUTCMonth()];
    const weekday = t.readings.weekdaysFull[(d.getUTCDay() + 6) % 7];
    return `${day} ${monthName} (${weekday})`;
  }

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <Link href="/" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.readings.backToHome}
          </Link>
          <h1 className="text-screen-title">{t.readings.title}</h1>

          {points.length === 0 ? (
            <p className="mt-4 text-body-airbnb text-muted-foreground">{t.readings.pointsEmptyHint}</p>
          ) : (
            <>
              {points.length > 1 ? (
                <div className="mt-4">
                  <Select
                    value={pointId ?? undefined}
                    onValueChange={(v) => {
                      if (!v) return;
                      setPointId(v);
                      setSelectedDate(null);
                      setCards(null);
                    }}
                    items={points.map((p) => ({ value: p.id, label: p.name }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          {(() => {
                            const current = points.find((p) => p.id === pointId);
                            return current?.iconKey ? (
                              <AssetOrZoneIcon iconKey={current.iconKey} className="size-6 shrink-0" />
                            ) : (
                              <MapPin className="size-6 shrink-0 text-muted-foreground" />
                            );
                          })()}
                          {points.find((p) => p.id === pointId)?.name}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {points.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            {p.iconKey ? (
                              <AssetOrZoneIcon iconKey={p.iconKey} className="size-6 shrink-0" />
                            ) : (
                              <MapPin className="size-6 shrink-0 text-muted-foreground" />
                            )}
                            {p.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="mt-4 text-caption-airbnb">{points[0]?.name}</p>
              )}

              <SpringCard hover={false} className="mt-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    aria-label={t.readings.prevMonth}
                    onClick={() => goMonth(-1)}
                    className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                  >
                    <ChevronLeft className="size-4.5" />
                  </button>
                  <p className="text-card-title">
                    {t.readings.months[month - 1]} {year}
                  </p>
                  <button
                    type="button"
                    aria-label={t.readings.nextMonth}
                    onClick={() => goMonth(1)}
                    disabled={isCurrentMonth}
                    className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                  >
                    <ChevronRight className="size-4.5" />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {t.readings.weekdays.map((w) => (
                    <span key={w} className="text-caption-airbnb font-semibold">
                      {w}
                    </span>
                  ))}
                  {cells.map((date, i) => {
                    if (!date) return <span key={`blank-${i}`} />;
                    const active = activeDates.has(date);
                    const day = Number(date.slice(-2));
                    return (
                      <button
                        key={date}
                        type="button"
                        disabled={!active}
                        onClick={() => openDay(date)}
                        className={cn(
                          "relative flex aspect-square items-center justify-center rounded-control text-[0.84375rem] font-semibold tabular-nums",
                          active ? "bg-primary text-primary-foreground" : "text-muted-foreground/70",
                          date === todayKey && !active && "text-foreground",
                          date === selectedDate && active && "ring-2 ring-primary ring-offset-2 ring-offset-card"
                        )}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </SpringCard>

              {selectedDate && (
                <div className="flex flex-col gap-3">
                  {cards === null ? null : cards.length === 0 ? (
                    <p className="mt-1 text-body-airbnb text-muted-foreground">
                      {t.readings.noSubmissionsPrefix} {formatReadableDate(selectedDate)}
                    </p>
                  ) : (
                    cards.map((card) => (
                      <SpringCard key={card.zoneSubmissionId} hover={false} className="flex flex-col gap-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 grow">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-body-airbnb font-bold">{formatReadableDate(selectedDate)}</span>
                              <span className="text-caption-airbnb tabular-nums">{formatTime(card.submittedAt)}</span>
                              {card.edited && (
                                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                                  {t.readings.editedByOwner}
                                </span>
                              )}
                            </div>
                            <p className="text-caption-airbnb">
                              {t.readings.operatorLabel}: {card.operatorName}
                              {card.accountingMode === "counters" &&
                                card.editable &&
                                ` · ${t.readings.lastSubmissionNote}`}
                            </p>
                          </div>
                          <KebabButton onClick={() => openActions(card)} label={t.readings.actionsLabel} />
                        </div>

                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-caption-airbnb font-bold">{card.zoneName}</p>
                          {card.accountingMode !== "cash_only" &&
                            card.assets.map((asset) => (
                              <div key={asset.assetId} className="mt-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: asset.colorTag }}
                                  />
                                  <span className="text-caption-airbnb font-semibold text-foreground">
                                    {asset.assetName}
                                  </span>
                                </div>
                                {asset.readings.map((r) => (
                                  <div
                                    key={r.tariffId}
                                    className="flex items-center justify-between py-1 pl-4 text-caption-airbnb"
                                  >
                                    <span>{r.tariffName}</span>
                                    <span className="flex items-center gap-1.5 tabular-nums">
                                      {r.editedBefore !== null && (
                                        <Info
                                          className="size-3.5 shrink-0 text-warning"
                                          aria-label={`${t.readings.editedByOwner} · ${t.readings.wasLabel}: ${r.editedBefore}`}
                                        />
                                      )}
                                      {r.previousValue !== null && (
                                        <span className="text-muted-foreground">
                                          {r.previousValue} → <b className="text-foreground">{r.value}</b>
                                        </span>
                                      )}
                                      <span className="min-w-10 text-right font-bold text-primary">
                                        +{r.sessions}
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ))}
                        </div>

                        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 tabular-nums">
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span className="flex items-center gap-1.5">
                              {t.operatorApp.submit.cashLabel}
                              {card.cashEditedBefore !== null && (
                                <Info
                                  className="size-3.5 shrink-0 text-warning"
                                  aria-label={`${t.readings.editedByOwner} · ${t.readings.wasLabel}: ${card.cashEditedBefore.toFixed(2)}`}
                                />
                              )}
                            </span>
                            <span className="text-foreground">{card.cashAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span>{t.operatorApp.submit.mobileLabel}</span>
                            <span className="text-foreground">{card.mobileAmount.toFixed(2)}</span>
                          </div>
                          {card.accountingMode !== "cash_only" && (
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span>{t.operatorApp.submit.returnsLabel}</span>
                            <span className="text-foreground">{card.returnsCount}</span>
                          </div>
                          )}
                          {card.accountingMode !== "cash_only" && (
                          <>
                          <div className="flex items-center justify-between border-t border-border pt-1.5 text-caption-airbnb font-semibold">
                            <span className="text-foreground">{t.operatorApp.submit.calculatedRevenue}</span>
                            <span className="text-foreground">{card.calculatedRevenue.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span>{t.operatorApp.submit.difference}</span>
                            <span
                              className={cn(
                                "font-bold",
                                card.difference === 0
                                  ? "text-muted-foreground"
                                  : card.difference > 0
                                    ? "text-primary"
                                    : "text-destructive"
                              )}
                            >
                              {card.difference > 0 ? "+" : ""}
                              {card.difference.toFixed(2)}
                            </span>
                          </div>
                          </>
                          )}
                        </div>

                        {!card.editable && (
                          <p className="mt-3 rounded-control bg-surface-0 p-3 text-xs leading-relaxed text-muted-foreground">
                            {t.readings.lockedNote}
                          </p>
                        )}
                      </SpringCard>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <BottomSheet open={actionsFor !== null && actionsView === "menu"} onClose={() => setActionsFor(null)}>
        {actionsFor && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.readings.actionsSheetPrefix} {formatTime(actionsFor.submittedAt)}
            </h2>
            {!actionsFor.editable && (
              <p className="mb-2 text-sm text-muted-foreground">{t.readings.lockedNote}</p>
            )}
            <ActionSheetItem icon={Pencil} onClick={openEdit}>
              {actionsFor.editable ? (
                t.readings.editAction
              ) : (
                <span className="text-muted-foreground">{t.readings.editAction}</span>
              )}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive={actionsFor.editable} onClick={() => setActionsView("confirm-delete")}>
              {actionsFor.editable ? (
                t.readings.deleteAction
              ) : (
                <span className="text-muted-foreground">{t.readings.deleteAction}</span>
              )}
            </ActionSheetItem>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={actionsFor !== null && actionsView === "edit"} onClose={() => setActionsFor(null)}>
        {actionsFor && (
          <div className="flex flex-col gap-4 pt-2">
            <div>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.readings.editSheetTitle}</h2>
              <p className="text-caption-airbnb">{t.readings.autoRecalcHint}</p>
            </div>

            {actionsFor.assets.map((asset) => (
              <div key={asset.assetId} className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
                    {asset.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.photoUrl} alt="" className="size-full object-contain object-center" />
                    ) : asset.iconKey ? (
                      <AssetOrZoneIcon iconKey={asset.iconKey} className="size-4.5 text-muted-foreground" />
                    ) : null}
                    <span
                      className="absolute left-1 top-1 size-2.5 rounded-full ring-2 ring-card"
                      style={{ backgroundColor: asset.colorTag }}
                    />
                  </div>
                  <p className="text-section-title">
                    {asset.assetName} · {t.readings.readingsSectionSuffix}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {asset.readings.map((r) => {
                    const key = `${asset.assetId}:${r.tariffId}`;
                    return (
                      <div key={r.tariffId} className="flex flex-col gap-1">
                        <Label htmlFor={key} className="flex-col items-start gap-0.5">
                          <span>{r.tariffName}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {t.operatorApp.submit.previousReading} {r.previousValue}
                          </span>
                        </Label>
                        <Input
                          id={key}
                          inputMode="numeric"
                          className="tabular-nums"
                          value={editReadings[key] ?? ""}
                          onChange={(e) => setEditReadings((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-2">
              <p className="text-section-title">{t.readings.moneySection}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="editCash">{t.operatorApp.submit.cashLabel}</Label>
                  <Input
                    id="editCash"
                    inputMode="decimal"
                    className="tabular-nums"
                    value={editCash}
                    onChange={(e) => setEditCash(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="editMobile">{t.operatorApp.submit.mobileLabel}</Label>
                  <Input
                    id="editMobile"
                    inputMode="decimal"
                    className="tabular-nums"
                    value={editMobile}
                    onChange={(e) => setEditMobile(e.target.value)}
                  />
                </div>
              </div>
              {actionsFor.accountingMode !== "cash_only" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="editReturns">{t.operatorApp.submit.returnsLabel}</Label>
                  <Input
                    id="editReturns"
                    inputMode="numeric"
                    className="tabular-nums"
                    value={editReturns}
                    onChange={(e) => setEditReturns(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="editReason">
                {t.readings.reasonLabel}{" "}
                <span className="font-normal text-muted-foreground">· {t.readings.reasonOptionalHint}</span>
              </Label>
              <Input
                id="editReason"
                placeholder={t.readings.reasonPlaceholder}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
              />
            </div>

            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setActionsFor(null)}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button className="w-full" onClick={confirmEdit}>
                  {t.readings.saveChangesButton}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={actionsFor !== null && actionsView === "confirm-delete"} onClose={() => setActionsFor(null)}>
        {actionsFor && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.readings.deleteConfirmTitle}</h2>
            <p className="text-body-airbnb">{t.readings.deleteConfirmBody}</p>
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={deleting} onClick={() => setActionsView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button variant="destructive" className="w-full" disabled={deleting} onClick={confirmDelete}>
                  {t.readings.deleteAction}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}
