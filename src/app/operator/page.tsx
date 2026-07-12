"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRightLeft, Check, ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { SweepButton } from "@/components/motion/SweepButton";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface ZoneOption {
  id: string;
  name: string;
}

interface PointOption {
  id: string;
  name: string;
  iconKey: string | null;
}

interface OperatorTask {
  id: string;
  title: string;
  note: string | null;
  status: "todo" | "doing" | "done";
  shared: boolean;
}

export default function OperatorHomePage() {
  const router = useRouter();
  const t = useI18n();
  const [operatorName, setOperatorName] = useState<string | null>(null);
  const [operatorAvatarUrl, setOperatorAvatarUrl] = useState<string | null>(null);
  const [operatorIconKey, setOperatorIconKey] = useState<string | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [pointName, setPointName] = useState<string | null>(null);
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [checking, setChecking] = useState(true);
  const [workTimeEnabled, setWorkTimeEnabled] = useState(false);
  const [toPayOut, setToPayOut] = useState<number | null>(null);
  const [timeTrackingMode, setTimeTrackingMode] = useState<"manual" | "auto">("manual");
  const [activeShiftStartAt, setActiveShiftStartAt] = useState<string | null>(null);
  const [checkInOutBusy, setCheckInOutBusy] = useState(false);
  const [checkInOutError, setCheckInOutError] = useState<string | null>(null);
  const [checkoutSheetOpen, setCheckoutSheetOpen] = useState(false);
  const [checkoutAdvance, setCheckoutAdvance] = useState("");
  const [checkoutBonus, setCheckoutBonus] = useState("");
  const [checkoutSheetError, setCheckoutSheetError] = useState<string | null>(null);
  // Мягкие напоминания после check-in/check-out (docs/spec/05-work-time.md,
  // "СВЯЗЬ СО СДАЧЕЙ ИТОГОВ") — то же самое уведомление, что в ручном режиме.
  const [homeNotice, setHomeNotice] = useState<{ warnings: string[]; noResultsToday: boolean } | null>(null);
  // Единый тикер (раз в секунду) — от него живут и текущее время под "Начать
  // смену", и счётчик отработанного времени, и живой предпросмотр интервала/
  // длительности в bottom sheet завершения.
  const [now, setNow] = useState(() => new Date());
  const [roaming, setRoaming] = useState(false);
  const [points, setPoints] = useState<PointOption[]>([]);

  const [showCollection, setShowCollection] = useState(false);
  const [collectionZoneId, setCollectionZoneId] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collectionDone, setCollectionDone] = useState(false);

  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [doneToday, setDoneToday] = useState(0);
  const [openTask, setOpenTask] = useState<OperatorTask | null>(null);
  const [advancing, setAdvancing] = useState(false);

  function loadMe() {
    fetch("/api/auth/operator/me")
      .then((res) => res.json())
      .then((data) => {
        if (!data.device || !data.operator) {
          router.replace("/operator/login");
          return;
        }
        setOperatorName(data.operator.name);
        setOperatorAvatarUrl(data.operator.avatarUrl ?? null);
        setOperatorIconKey(data.operator.iconKey ?? null);
        setPointId(data.device.pointId);
        setPointName(data.device.pointName);
        setRoaming(data.device.roaming === true);
        setWorkTimeEnabled(!!data.workTimeEnabled);
        setTimeTrackingMode(data.timeTrackingMode === "auto" ? "auto" : "manual");
        setActiveShiftStartAt(data.activeShift?.startAt ?? null);
        setChecking(false);
        if (data.workTimeEnabled) {
          fetch("/api/operator/work-time/summary")
            .then((res) => (res.ok ? res.json() : null))
            .then((summary) => setToPayOut(summary ? summary.toPayOut : null));
        }
      });
  }

  function loadZones() {
    fetch("/api/operator/submission-context")
      .then((res) => res.json())
      .then((data) => setZones((data.zones ?? []).map((z: ZoneOption) => ({ id: z.id, name: z.name }))));
  }

  function loadTasks() {
    fetch("/api/operator/tasks")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setTasks(data.tasks ?? []);
        setDoneToday(data.doneToday ?? 0);
      });
  }

  useEffect(() => {
    loadMe();
    loadZones();
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!roaming) return;
    fetch("/api/operator/points")
      .then((res) => res.json())
      .then((data) => setPoints(data.points ?? []));
  }, [roaming]);

  // Тикает раз в секунду, пока есть что показывать живым (текущее время до
  // check-in, счётчик/предпросмотр интервала после) — ничего не запрашивает
  // с сервера, серверный started_at остаётся единственным источником истины.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  function formatElapsed(startIso: string, at: Date): string {
    const minutesTotal = Math.max(0, Math.floor((at.getTime() - new Date(startIso).getTime()) / 60000));
    const h = Math.floor(minutesTotal / 60);
    const m = minutesTotal % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function formatClock(at: Date): string {
    return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}:${String(at.getSeconds()).padStart(2, "0")}`;
  }

  const elapsedLabel = activeShiftStartAt ? formatElapsed(activeShiftStartAt, now) : "00:00";
  const shiftTooLong = activeShiftStartAt ? now.getTime() - new Date(activeShiftStartAt).getTime() > 16 * 60 * 60 * 1000 : false;

  async function handleCheckIn() {
    setCheckInOutError(null);
    setCheckInOutBusy(true);
    try {
      const res = await fetch("/api/operator/work-time/check-in", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setCheckInOutError(data.error ?? t.operatorApp.workTime.saveError);
        return;
      }
      setActiveShiftStartAt(data.shift.startAt);
      setHomeNotice(data.noResultsToday ? { warnings: [], noResultsToday: true } : null);
    } finally {
      setCheckInOutBusy(false);
    }
  }

  // Один тап "Закончить смену" сразу открывает bottom sheet подтверждения
  // (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА ВРЕМЕНИ") — кнопка "Завершить"
  // внутри него и есть подтверждение, отдельного "Точно?" на кнопке больше нет.
  function openCheckoutSheet() {
    setCheckoutAdvance("");
    setCheckoutBonus("");
    setCheckoutSheetError(null);
    setCheckoutSheetOpen(true);
  }

  async function handleCheckOut() {
    setCheckoutSheetError(null);
    setCheckInOutBusy(true);
    try {
      const res = await fetch("/api/operator/work-time/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advanceAmount: checkoutAdvance ? Number(checkoutAdvance) : 0,
          bonusAmount: checkoutBonus ? Number(checkoutBonus) : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutSheetError(data.error ?? t.operatorApp.workTime.saveError);
        return;
      }
      setActiveShiftStartAt(null);
      setToPayOut(data.balance.toPayOut);
      setCheckoutSheetOpen(false);
      if (data.warnings?.length || data.noResultsToday) {
        setHomeNotice({ warnings: data.warnings ?? [], noResultsToday: !!data.noResultsToday });
      } else {
        setHomeNotice(null);
      }
    } finally {
      setCheckInOutBusy(false);
    }
  }

  function warningText(code: string) {
    if (code === "too_long") return t.operatorApp.workTime.warningTooLong;
    return code;
  }

  async function advanceOpenTask() {
    if (!openTask) return;
    setAdvancing(true);
    try {
      await fetch(`/api/operator/tasks/${openTask.id}/progress`, { method: "POST" });
      setOpenTask(null);
      loadTasks();
    } finally {
      setAdvancing(false);
    }
  }

  async function handleSwitchOperator() {
    await fetch("/api/auth/operator/logout", { method: "POST" });
    router.push("/operator/login");
    router.refresh();
  }

  async function handleSwitchPoint(targetPointId: string) {
    const res = await fetch("/api/operator/switch-point", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointId: targetPointId }),
    });
    if (!res.ok) return;
    loadMe();
    loadZones();
    loadTasks();
  }

  async function handleCollection(event: FormEvent) {
    event.preventDefault();
    setCollectionError(null);
    if (!collectionZoneId) {
      setCollectionError(t.operatorApp.selectZone);
      return;
    }

    const res = await fetch("/api/operator/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zoneId: collectionZoneId, amount: collectionAmount }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCollectionError(data.error ?? "Не удалось провести инкассацию");
      return;
    }
    setCollectionDone(true);
    setCollectionAmount("");
  }

  function openCollection() {
    setCollectionZoneId("");
    setCollectionAmount("");
    setCollectionError(null);
    setCollectionDone(false);
    setShowCollection(true);
  }

  if (checking) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-surface-0 px-4">
      <SpringCard hover={false} className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          {operatorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={operatorAvatarUrl} alt="" className="size-21 rounded-full object-cover" />
          ) : operatorIconKey ? (
            <div className="flex size-21 items-center justify-center rounded-full bg-primary/10">
              <AssetOrZoneIcon iconKey={operatorIconKey} className="size-12" />
            </div>
          ) : (
            <div className="flex size-21 items-center justify-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">
              {operatorName?.slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 className="text-screen-title">
            {t.operatorApp.greeting} {operatorName}
          </h1>
          {roaming && points.length > 1 ? (
            <div className="flex w-full items-center gap-2 text-left">
              <p className="shrink-0 text-body-airbnb text-muted-foreground">{t.operatorApp.pointLabel}</p>
              <div className="min-w-0 flex-1">
                <Select
                  value={pointId ?? undefined}
                  onValueChange={(v) => v && handleSwitchPoint(v)}
                  items={points.map((p) => ({ value: p.id, label: p.name }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      <span className="flex items-center gap-2">
                        {(() => {
                          const current = points.find((p) => p.id === pointId);
                          return current?.iconKey ? (
                            <AssetOrZoneIcon iconKey={current.iconKey} className="size-5 shrink-0" />
                          ) : (
                            <MapPin className="size-5 shrink-0 text-muted-foreground" />
                          );
                        })()}
                        {pointName}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {points.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          {p.iconKey ? (
                            <AssetOrZoneIcon iconKey={p.iconKey} className="size-5 shrink-0" />
                          ) : (
                            <MapPin className="size-5 shrink-0 text-muted-foreground" />
                          )}
                          {p.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <p className="text-body-airbnb text-muted-foreground">
              {t.operatorApp.pointLabel} <span className="font-semibold text-foreground">{pointName}</span>
            </p>
          )}
        </div>

        {workTimeEnabled && toPayOut !== null && (
          <PressableScale className="mt-6">
            <button
              type="button"
              onClick={() => router.push("/operator/work-time")}
              className="flex w-full items-center justify-between rounded-control border border-border bg-card px-4 py-3 text-left"
            >
              <span>
                <span className="block text-caption-airbnb text-muted-foreground">
                  {t.operatorApp.workTime.toPayOutLabel}
                </span>
                <span className="block text-[19px] font-extrabold tabular-nums">{toPayOut.toFixed(2)}</span>
              </span>
              <span className="flex items-center gap-1 text-caption-airbnb font-semibold text-primary">
                {t.operatorApp.workTime.viewAllLink}
                <ChevronRight className="size-4" />
              </span>
            </button>
          </PressableScale>
        )}

        <div className={cn("mt-6 grid gap-2.5", workTimeEnabled ? "grid-cols-3" : "grid-cols-2")}>
          <PressableScale>
            <Button
              className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-control p-2 text-center text-xs font-bold"
              onClick={() => router.push("/operator/submit")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/icon-library/app-icons/calculator.svg" alt="" className="size-7" />
              <span className="leading-tight">{t.operatorApp.submitResults}</span>
            </Button>
          </PressableScale>

          {workTimeEnabled && timeTrackingMode === "manual" && (
            <PressableScale>
              <Button
                variant="outline"
                className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-control border-2 p-2 text-center text-xs font-bold"
                onClick={() => router.push("/operator/work-time?add=1")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/icon-library/app-icons/clock.svg" alt="" className="size-7" />
                <span className="leading-tight">{t.operatorApp.workTime.addShiftButton}</span>
              </Button>
            </PressableScale>
          )}

          {workTimeEnabled && timeTrackingMode === "auto" && activeShiftStartAt && (
            <PressableScale>
              <SweepButton
                disabled={checkInOutBusy}
                onClick={openCheckoutSheet}
                className="flex h-24 w-full flex-col items-center justify-center gap-0.5 px-1 text-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/icon-library/app-icons/stop_squared.svg" alt="" className="size-5" />
                <span className="text-[11px] leading-tight font-bold">{t.operatorApp.workTime.checkoutButton}</span>
                <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{elapsedLabel}</span>
              </SweepButton>
            </PressableScale>
          )}

          {workTimeEnabled && timeTrackingMode === "auto" && !activeShiftStartAt && (
            <PressableScale>
              <Button
                variant="outline"
                disabled={checkInOutBusy}
                className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-control border-2 p-2 text-center text-xs font-bold"
                onClick={handleCheckIn}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/icon-library/app-icons/Square%20Play%20Button.svg" alt="" className="size-6" />
                <span className="leading-tight">{t.operatorApp.workTime.checkinButton}</span>
                <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{formatClock(now)}</span>
              </Button>
            </PressableScale>
          )}

          <PressableScale>
            <Button
              variant="outline"
              className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-control border-2 p-2 text-center text-xs font-bold"
              onClick={openCollection}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/icon-library/app-icons/Transfer%20Money.svg" alt="" className="size-7" />
              <span className="leading-tight">{t.operatorApp.collection}</span>
            </Button>
          </PressableScale>
        </div>
        {checkInOutError && <p className="mt-2 text-center text-caption-airbnb text-destructive">{checkInOutError}</p>}

        {shiftTooLong && (
          <div className="mt-3 rounded-control bg-warning/15 p-3 text-sm font-medium text-warning">
            {t.operatorApp.workTime.shiftTooLongBanner}
          </div>
        )}

        {homeNotice && (
          <div className="mt-3 flex flex-col gap-1.5 rounded-control bg-warning/15 p-3">
            {homeNotice.warnings.map((w) => (
              <p key={w} className="text-sm font-medium text-warning">
                {warningText(w)}
              </p>
            ))}
            {homeNotice.noResultsToday && (
              <p className="text-sm font-medium text-warning">{t.operatorApp.workTime.noResultsTodayNote}</p>
            )}
          </div>
        )}
      </SpringCard>

      <SpringCard hover={false} className="mt-4 w-full max-w-sm text-left">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="text-[14px] font-extrabold tracking-[-0.01em]">{t.operatorApp.tasks.title}</h2>
          <span className="text-caption-airbnb">
            {tasks.length > 0
              ? `${tasks.length} ${t.operatorApp.tasks.activeCountSuffix}`
              : t.operatorApp.tasks.allDone}
          </span>
        </div>
        {tasks.length === 0 ? (
          <p className="py-3 text-center text-caption-airbnb">{t.operatorApp.tasks.noActiveTasks}</p>
        ) : (
          tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => setOpenTask(task)}
              className="flex w-full items-center gap-2.5 border-t border-border py-3 text-left first:border-t-0"
            >
              <span
                className={cn(
                  "flex size-5.5 shrink-0 items-center justify-center rounded-full border-2",
                  task.status === "doing" ? "border-warning bg-warning/15" : "border-muted-foreground/40"
                )}
              >
                {task.status === "doing" && <span className="size-2 rounded-full bg-warning" />}
              </span>
              <span className="min-w-0 grow">
                <span className="block text-body-airbnb font-semibold leading-snug">{task.title}</span>
                {task.note && <span className="mt-0.5 block text-caption-airbnb leading-snug">{task.note}</span>}
                <span className="block text-caption-airbnb">
                  {task.status === "doing" ? t.operatorApp.tasks.statusDoing : t.operatorApp.tasks.statusTodo}
                  {task.shared && ` · ${t.operatorApp.tasks.sharedSuffix}`}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
        {doneToday > 0 && (
          <div className="mt-1 flex items-center gap-2 border-t border-border pt-3 text-caption-airbnb">
            <Check className="size-3.5 shrink-0" />
            {t.operatorApp.tasks.doneTodayPrefix} {doneToday}
          </div>
        )}
      </SpringCard>

      <BottomSheet open={openTask !== null} onClose={() => setOpenTask(null)}>
        {openTask && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{openTask.title}</h2>
            <p className="text-body-airbnb text-muted-foreground">{openTask.note || t.operatorApp.tasks.noNote}</p>
            <PressableScale>
              <Button
                className="h-14 w-full gap-2 text-base font-bold"
                disabled={advancing}
                onClick={advanceOpenTask}
              >
                {openTask.status === "todo" ? t.operatorApp.tasks.takeInProgress : t.operatorApp.tasks.markDone}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={showCollection} onClose={() => setShowCollection(false)}>
        <form onSubmit={handleCollection} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operatorApp.collection}</h2>
          {collectionDone ? (
            <p className="text-body-airbnb text-success">{t.operatorApp.collectionDone}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="collectionZone">{t.operatorApp.zoneLabel}</Label>
                <Select
                  value={collectionZoneId || null}
                  onValueChange={(v) => setCollectionZoneId(v ?? "")}
                  items={zones.map((z) => ({ value: z.id, label: z.name }))}
                >
                  <SelectTrigger id="collectionZone" className="h-14 border-2 text-base">
                    <SelectValue placeholder={t.operatorApp.selectZone} />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="collectionAmount">{t.operatorApp.collectionAmountLabel}</Label>
                <Input
                  id="collectionAmount"
                  inputMode="numeric"
                  className="h-14 border-2 text-lg tabular-nums"
                  value={collectionAmount}
                  onChange={(e) => setCollectionAmount(e.target.value)}
                  required
                />
              </div>
              {collectionError && <p className="text-sm text-destructive">{collectionError}</p>}
              <PressableScale>
                <Button type="submit" className="h-14 w-full gap-2 text-base font-bold">
                  <Check className="size-4" />
                  {t.operatorApp.recordCollection}
                </Button>
              </PressableScale>
            </>
          )}
        </form>
      </BottomSheet>

      <BottomSheet open={checkoutSheetOpen} onClose={() => !checkInOutBusy && setCheckoutSheetOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operatorApp.workTime.checkoutButton}</h2>

          {activeShiftStartAt && (
            <div className="rounded-control bg-muted/40 p-3 text-center">
              <p className="tabular-nums text-body-airbnb font-semibold">
                {formatClock(new Date(activeShiftStartAt)).slice(0, 5)}–{formatClock(now).slice(0, 5)}
              </p>
              <p className="tabular-nums text-caption-airbnb text-muted-foreground">{elapsedLabel}</p>
            </div>
          )}
          {shiftTooLong && (
            <p className="text-sm font-medium text-warning">{t.operatorApp.workTime.warningTooLong}</p>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="checkoutAdvance">{t.operatorApp.workTime.advanceFieldLabel}</Label>
            <Input
              id="checkoutAdvance"
              inputMode="decimal"
              className="h-14 text-lg tabular-nums"
              value={checkoutAdvance}
              onChange={(e) => setCheckoutAdvance(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="checkoutBonus">{t.operatorApp.workTime.bonusFieldLabel}</Label>
            <Input
              id="checkoutBonus"
              inputMode="decimal"
              className="h-14 text-lg tabular-nums"
              value={checkoutBonus}
              onChange={(e) => setCheckoutBonus(e.target.value)}
              placeholder="0"
            />
          </div>
          {checkoutSheetError && <p className="text-sm text-destructive">{checkoutSheetError}</p>}
          <PressableScale>
            <Button onClick={handleCheckOut} disabled={checkInOutBusy} className="h-14 w-full rounded-control font-bold">
              {t.operatorApp.workTime.checkoutButton}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <button
        type="button"
        className="mt-6 flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground"
        onClick={handleSwitchOperator}
      >
        <ArrowRightLeft className="size-3.5" />
        {t.operatorApp.switchOperator}
      </button>
    </div>
  );
}
