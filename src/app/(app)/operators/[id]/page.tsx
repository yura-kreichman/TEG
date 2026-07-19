"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/time-input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconActionButton } from "@/components/kebab-menu";
import { StatusChip } from "@/components/status-chip";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { cn } from "@/lib/utils";
import { formatDuration as formatDurationBase, formatTime } from "@/lib/datetime-format";
import {
  formatPeriodLabel as formatPeriodLabelFor,
  isCurrentPeriod as isCurrentPeriodFor,
  periodRange as periodRangeFor,
  steppedAnchor,
  type PeriodGranularity,
} from "@/lib/period-nav";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface Profile {
  id: string;
  name: string;
  active: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  colorTag: string | null;
  allZonesAccess: boolean;
  allowedZones: { id: string; name: string; pointId: string }[];
  timeTrackingMode: "manual" | "auto";
}

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
  endAt: string | null;
  minutes: number | null;
  rate: number | null;
  accrued: number | null;
  advanceAmount: number;
  bonusAmount: number;
  edited: boolean;
  open: boolean;
  requiresEdit: boolean;
}

interface StandaloneMoneyOp {
  id: string;
  type: "advance" | "bonus_payout";
  amount: number;
  occurredAt: string;
  comment: string | null;
}

interface PointOption {
  id: string;
  name: string;
}

function timeInputValue(iso: string) {
  return formatTime(iso);
}

export default function OperatorCardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [moduleEnabled, setModuleEnabled] = useState(true);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [standaloneMoneyOps, setStandaloneMoneyOps] = useState<StandaloneMoneyOp[]>([]);
  const [carryoverTotal, setCarryoverTotal] = useState(0);
  const [points, setPoints] = useState<PointOption[]>([]);
  // Ручной перенос баланса (docs/spec/05-work-time.md, "БАЛАНС") — API уже
  // существовал (POST .../work-time/carryover), но нигде в интерфейсе не
  // было кнопки его вызвать (запрос пользователя 2026-07-14: перенос остатка
  // "к выдаче" из прошлой программы учёта при старте реального теста).
  const [carryoverOpen, setCarryoverOpen] = useState(false);
  const [carryoverAmount, setCarryoverAmount] = useState("");
  const [carryoverComment, setCarryoverComment] = useState("");
  const [carryoverError, setCarryoverError] = useState<string | null>(null);
  const { saved: carryoverSaved, pulse: carryoverPulse } = useSavePulse();

  const [granularity, setGranularity] = useState<PeriodGranularity>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  const [moneyForm, setMoneyForm] = useState<"advance" | "bonus" | null>(null);
  const [moneyAmount, setMoneyAmount] = useState("");
  const [moneyPointId, setMoneyPointId] = useState("");
  const [moneyError, setMoneyError] = useState<string | null>(null);
  const { saved: moneyFormSaved, pulse: moneyFormPulse } = useSavePulse();

  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  // Открытая смена — по умолчанию правим только начало, не закрывая её
  // (запрос пользователя 2026-07-14: "забыл начать смену, вспомнил через
  // час" — раньше любая правка вынужденно закрывала смену). Владелец сам
  // включает этот тумблер, если действительно хочет закрыть смену за
  // оператора прямо сейчас.
  const [closeShiftToo, setCloseShiftToo] = useState(false);
  const [editAdvance, setEditAdvance] = useState("");
  const [editBonus, setEditBonus] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editWarnings, setEditWarnings] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteShift, setConfirmDeleteShift] = useState(false);
  const [deletingShift, setDeletingShift] = useState(false);
  const { saved: shiftDeleted, pulse: shiftDeletePulse } = useSavePulse();
  const { saved: shiftSaved, pulse: shiftPulse } = useSavePulse();

  const [editingMoneyOp, setEditingMoneyOp] = useState<StandaloneMoneyOp | null>(null);
  const [editMoneyOpAmount, setEditMoneyOpAmount] = useState("");
  const [editMoneyOpError, setEditMoneyOpError] = useState<string | null>(null);
  const [confirmDeleteMoneyOp, setConfirmDeleteMoneyOp] = useState(false);
  const [deletingMoneyOp, setDeletingMoneyOp] = useState(false);
  const { saved: moneyOpDeleted, pulse: moneyOpDeletePulse } = useSavePulse();
  const { saved: moneyOpSaved, pulse: moneyOpPulse } = useSavePulse();

  function openMoneyOpEdit(op: StandaloneMoneyOp) {
    setEditingMoneyOp(op);
    setEditMoneyOpAmount(String(op.amount));
    setEditMoneyOpError(null);
    setConfirmDeleteMoneyOp(false);
  }

  async function submitMoneyOpEdit() {
    if (!editingMoneyOp) return;
    setEditMoneyOpError(null);
    const res = await fetch(`/api/work-time/money-ops/${editingMoneyOp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(editMoneyOpAmount) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEditMoneyOpError(data.error ?? t.operatorApp.workTime.saveError);
      return;
    }
    await loadAll();
    moneyOpPulse(() => setEditingMoneyOp(null));
  }

  async function deleteMoneyOp() {
    if (!editingMoneyOp) return;
    setDeletingMoneyOp(true);
    setEditMoneyOpError(null);
    const res = await fetch(`/api/work-time/money-ops/${editingMoneyOp.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setEditMoneyOpError(data.error ?? t.operatorApp.workTime.saveError);
      setDeletingMoneyOp(false);
      return;
    }
    setDeletingMoneyOp(false);
    await loadAll();
    moneyOpDeletePulse(() => setEditingMoneyOp(null));
  }

  async function loadAll() {
    const { from, to } = periodRangeFor(granularity, anchor);
    const [profileRes, summaryRes, shiftsRes, carryoverRes, pointsRes] = await Promise.all([
      fetch(`/api/operators/${params.id}`),
      fetch(`/api/operators/${params.id}/work-time/summary?from=${from}&to=${to}`),
      fetch(`/api/operators/${params.id}/work-time/shifts?from=${from}&to=${to}`),
      fetch(`/api/operators/${params.id}/work-time/carryover`),
      fetch("/api/points"),
    ]);
    if (profileRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (!profileRes.ok) {
      router.replace("/operators");
      return;
    }
    setProfile(await profileRes.json());

    // Модуль "Рабочее время" может быть не подключён у тенанта (feature flag) —
    // тогда все work-time роуты отвечают 403, а не валидным балансом/табелем.
    // Показываем страницу профиля без денежного блока вместо падения на undefined.
    if (!summaryRes.ok) {
      setModuleEnabled(false);
      const pointsData = await pointsRes.json();
      setPoints(pointsData.points ?? []);
      setChecking(false);
      return;
    }
    setModuleEnabled(true);
    setBalance(await summaryRes.json());
    const shiftsData = await shiftsRes.json();
    setShifts(shiftsData.shifts ?? []);
    setStandaloneMoneyOps(shiftsData.standaloneMoneyOps ?? []);
    const carryoverData = await carryoverRes.json();
    setCarryoverTotal(carryoverData.total ?? 0);
    const pointsData = await pointsRes.json();
    setPoints(pointsData.points ?? []);
    setChecking(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, anchor]);

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

  function formatShiftDate(iso: string) {
    const d = new Date(iso);
    return `${d.getDate()} ${t.readings.monthsGenitive[d.getMonth()]}`;
  }

  function formatDuration(minutes: number) {
    return formatDurationBase(minutes, t);
  }

  function warningText(code: string) {
    if (code === "too_long") return t.operatorApp.workTime.warningTooLong;
    return code;
  }

  // Точки, реально доступные этому оператору — не весь список точек
  // тенанта (фидбек пользователя 2026-07-12: "почему спрашивается из
  // какой точки аванс, даже если для оператора выбраны зоны только из
  // одной точки"). allZonesAccess — доступны все точки тенанта, иначе
  // только те, где есть хотя бы одна разрешённая зона.
  const operatorPointIds = profile?.allZonesAccess
    ? null
    : new Set((profile?.allowedZones ?? []).map((z) => z.pointId));
  const operatorPoints = operatorPointIds ? points.filter((p) => operatorPointIds.has(p.id)) : points;

  function openMoneyForm(kind: "advance" | "bonus") {
    setMoneyForm(kind);
    setMoneyAmount("");
    setMoneyPointId(operatorPoints[0]?.id ?? "");
    setMoneyError(null);
  }

  async function submitMoneyForm() {
    if (!moneyForm) return;
    setMoneyError(null);
    const res = await fetch(`/api/operators/${params.id}/work-time/${moneyForm}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(moneyAmount), pointId: moneyPointId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMoneyError(data.error ?? t.operatorApp.workTime.saveError);
      return;
    }
    await loadAll();
    moneyFormPulse(() => setMoneyForm(null));
  }

  function openCarryover() {
    setCarryoverAmount("");
    setCarryoverComment("");
    setCarryoverError(null);
    setCarryoverOpen(true);
  }

  async function confirmCarryover() {
    setCarryoverError(null);
    const amountNumber = Number(carryoverAmount);
    if (!Number.isFinite(amountNumber) || amountNumber === 0) {
      setCarryoverError(t.operatorApp.workTime.saveError);
      return;
    }
    const res = await fetch(`/api/operators/${params.id}/work-time/carryover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountNumber, comment: carryoverComment }),
    });
    if (!res.ok) {
      const data = await res.json();
      setCarryoverError(data.error ?? t.operatorApp.workTime.saveError);
      return;
    }
    await loadAll();
    carryoverPulse(() => setCarryoverOpen(false));
  }

  function openShiftEdit(shift: ShiftRow) {
    setEditingShift(shift);
    setEditStartTime(timeInputValue(shift.startAt));
    // Открытая смена (docs/spec/05-work-time.md) — endAt ещё не задан;
    // подставляем текущее время как разумный дефолт, если владелец всё же
    // решит её закрыть (см. closeShiftToo ниже).
    setEditEndTime(timeInputValue(shift.endAt ?? new Date().toISOString()));
    setCloseShiftToo(!shift.open);
    setEditAdvance(shift.advanceAmount ? String(shift.advanceAmount) : "");
    setEditBonus(shift.bonusAmount ? String(shift.bonusAmount) : "");
    setEditReason("");
    setEditWarnings([]);
    setEditError(null);
    setConfirmDeleteShift(false);
  }

  async function deleteShift() {
    if (!editingShift) return;
    setDeletingShift(true);
    setEditError(null);
    const res = await fetch(`/api/work-time/shifts/${editingShift.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setEditError(data.error ?? t.operatorApp.workTime.saveError);
      setDeletingShift(false);
      return;
    }
    setDeletingShift(false);
    await loadAll();
    shiftDeletePulse(() => setEditingShift(null));
  }

  async function submitShiftEdit() {
    if (!editingShift) return;
    setEditError(null);
    const base = new Date(editingShift.startAt);
    const dateY = base.getFullYear();
    const dateM = base.getMonth();
    const dateD = base.getDate();
    const [sh, sm] = editStartTime.split(":").map(Number);
    const startAt = new Date(dateY, dateM, dateD, sh, sm);

    // Открытая смена, которую владелец НЕ решил закрыть сейчас — endAt в
    // теле вообще не отправляем, правится только начало (см. PATCH-роут:
    // отсутствие endAt для открытой смены оставляет её открытой).
    const willClose = !editingShift.open || closeShiftToo;
    let endAtIso: string | undefined;
    if (willClose) {
      const [eh, em] = editEndTime.split(":").map(Number);
      let endAt = new Date(dateY, dateM, dateD, eh, em);
      if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
      endAtIso = endAt.toISOString();
    }

    const res = await fetch(`/api/work-time/shifts/${editingShift.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startAt: startAt.toISOString(),
        ...(endAtIso ? { endAt: endAtIso } : {}),
        advanceAmount: editAdvance ? Number(editAdvance) : 0,
        bonusAmount: editBonus ? Number(editBonus) : 0,
        reason: editReason || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEditError(data.error ?? t.operatorApp.workTime.saveError);
      return;
    }
    setEditWarnings(data.warnings ?? []);
    await loadAll();
    shiftPulse(() => {
      if (!data.warnings?.length) setEditingShift(null);
    });
  }

  if (checking || !profile) return null;

  // Смены и ручные авансы/премии (без смены) — одним хронологическим списком
  // (docs/spec/05-work-time.md: оператор/владелец должны видеть и то, и другое).
  type HistoryItem = { kind: "shift"; date: string; shift: ShiftRow } | { kind: "op"; date: string; op: StandaloneMoneyOp };
  const historyItems: HistoryItem[] = [
    ...shifts.map((s): HistoryItem => ({ kind: "shift", date: s.startAt, shift: s })),
    ...standaloneMoneyOps.map((o): HistoryItem => ({ kind: "op", date: o.occurredAt, op: o })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-4">
          <Link href="/operators" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.operators.title}
          </Link>

          <SpringCard hover={false} className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                {profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatarUrl} alt="" className="size-16 rounded-full object-cover" />
                ) : profile.iconKey ? (
                  <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
                    <AssetOrZoneIcon iconKey={profile.iconKey} className="size-14" />
                  </div>
                ) : (
                  <div className="flex size-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                    {profile.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {profile.colorTag && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-card"
                    style={{ backgroundColor: profile.colorTag }}
                  />
                )}
              </div>
              <div className="min-w-0 grow">
                <h1 className="text-card-title">{profile.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusChip variant={profile.active ? "accent" : "warning"}>
                    {profile.active ? t.operators.active : t.operators.inactive}
                  </StatusChip>
                </div>
              </div>
              {moduleEnabled && balance && (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.workTime.rateLabel}</span>
                  <span className="text-[1.0625rem] font-bold tabular-nums text-muted-foreground">
                    <Money value={balance.currentRate} />
                  </span>
                </div>
              )}
              <IconActionButton
                icon={Pencil}
                onClick={() => router.push(`/operators/${params.id}/settings`)}
                label={t.operators.actionsLabel}
              />
            </div>
          </SpringCard>

          {!moduleEnabled || !balance ? (
            <SpringCard hover={false}>
              <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.workTime.moduleDisabledNote}</p>
            </SpringCard>
          ) : (
            <>
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
                <div className="grid grid-cols-2 gap-3 border-t border-border pt-3.5 tabular-nums sm:grid-cols-4">
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
                <div className="flex gap-2 border-t border-border pt-3.5">
                  <PressableScale className="flex-1">
                    <Button variant="dark" size="sm" className="w-full gap-1.5" onClick={() => openMoneyForm("advance")}>
                      <Plus />
                      {t.operatorApp.workTime.advanceFieldLabel}
                    </Button>
                  </PressableScale>
                  <PressableScale className="flex-1">
                    <Button variant="dark" size="sm" className="w-full gap-1.5" onClick={() => openMoneyForm("bonus")}>
                      <Plus />
                      {t.operatorApp.workTime.bonusFieldLabel}
                    </Button>
                  </PressableScale>
                </div>
              </SpringCard>

              <div className="flex items-center justify-between">
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
                        granularity === g ? "bg-primary/10 text-primary" : "bg-surface-0 text-muted-foreground"
                      )}
                    >
                      {g === "week" ? t.money.periodWeek : t.money.periodMonth}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t.money.prevPeriod}
                    onClick={() => stepPeriod(-1)}
                    className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                  >
                    <ChevronLeft className="size-4.5" />
                  </button>
                  <p className="w-28 text-center text-caption-airbnb font-semibold text-foreground">
                    {formatPeriodLabel()}
                  </p>
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
              </div>

              <SpringCard hover={false} className="flex flex-col gap-1">
                <h2 className="text-section-title">{t.operatorApp.workTime.title}</h2>
                {shifts.length === 0 && standaloneMoneyOps.length === 0 ? (
                  <p className="py-3 text-body-airbnb text-muted-foreground">{t.operatorApp.workTime.noShifts}</p>
                ) : (
                  historyItems.map((item) =>
                    item.kind === "shift" ? (
                      <div
                        key={`shift-${item.shift.id}`}
                        className={cn(
                          "flex items-start gap-2 border-t border-border py-3 first:border-t-0",
                          item.shift.requiresEdit && "-mx-3 rounded-control border-t-0 bg-destructive/10 px-3"
                        )}
                      >
                        <div className="flex flex-1 flex-col gap-0.5">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-body-airbnb font-semibold">
                              {formatShiftDate(item.shift.startAt)}
                              {item.shift.edited && <Pencil className="size-3 text-muted-foreground" />}
                              {item.shift.requiresEdit && (
                                <span className="text-caption-airbnb font-semibold text-destructive">
                                  {t.operatorApp.workTime.requiresEditBadge}
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums text-body-airbnb font-bold">
                              {item.shift.open ? t.operatorApp.workTime.shiftInProgress : <Money value={item.shift.accrued!} />}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-0.5">
                              <span className="tabular-nums text-caption-airbnb">
                                {item.shift.open
                                  ? `${formatTime(item.shift.startAt)} – …`
                                  : `${formatTime(item.shift.startAt)}–${formatTime(item.shift.endAt!)}`}
                              </span>
                              {!item.shift.open && (
                                <span className="tabular-nums text-caption-airbnb">
                                  {formatDuration(item.shift.minutes!)}
                                </span>
                              )}
                            </div>
                            {(item.shift.advanceAmount > 0 || item.shift.bonusAmount > 0) && (
                              <div className="flex flex-col items-end gap-0.5 text-xs tabular-nums">
                                {item.shift.advanceAmount > 0 && (
                                  <span className="text-warning">
                                    {t.operatorApp.workTime.advanceInline}{" "}
                                    <span className="font-bold">
                                      <Money value={item.shift.advanceAmount} />
                                    </span>
                                  </span>
                                )}
                                {item.shift.bonusAmount > 0 && (
                                  <span className="text-success">
                                    {t.operatorApp.workTime.bonusInline}{" "}
                                    <span className="font-bold">
                                      <Money value={item.shift.bonusAmount} />
                                    </span>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <IconActionButton icon={Pencil} onClick={() => openShiftEdit(item.shift)} label={t.common.edit} />
                      </div>
                    ) : (
                      <div
                        key={`op-${item.op.id}`}
                        className="flex items-center gap-2 border-t border-border py-3 first:border-t-0"
                      >
                        <div className="flex flex-1 items-center justify-between">
                          <span className="text-body-airbnb font-semibold">
                            {formatShiftDate(item.op.occurredAt)} ·{" "}
                            {item.op.type === "advance" ? t.operatorApp.workTime.advanceFieldLabel : t.operatorApp.workTime.bonusFieldLabel}
                          </span>
                          <span
                            className={cn(
                              "tabular-nums text-body-airbnb font-bold",
                              item.op.type === "advance" ? "text-warning" : "text-success"
                            )}
                          >
                            <Money value={item.op.amount} />
                          </span>
                        </div>
                        <IconActionButton icon={Pencil} onClick={() => openMoneyOpEdit(item.op)} label={t.common.edit} />
                      </div>
                    )
                  )
                )}
                {carryoverTotal !== 0 && (
                  <div className="flex items-center justify-between border-t border-border py-3">
                    <span className="text-body-airbnb font-semibold">{t.operatorApp.workTime.carryoverLabel}</span>
                    <span className="tabular-nums text-body-airbnb font-bold"><Money value={carryoverTotal} /></span>
                  </div>
                )}
                <PressableScale className="border-t border-border pt-3">
                  <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={openCarryover}>
                    <Plus />
                    {t.operatorApp.workTime.carryoverAddButton}
                  </Button>
                </PressableScale>
              </SpringCard>
            </>
          )}
        </div>
      </div>

      <BottomSheet open={moneyForm !== null} onClose={() => setMoneyForm(null)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {moneyForm === "advance" ? t.operatorApp.workTime.advanceFieldLabel : t.operatorApp.workTime.bonusFieldLabel}
          </h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="moneyAmount">{t.money.amountLabel}</Label>
            <div className="flex items-center gap-2">
              <MoneyInput
                id="moneyAmount"
                autoFocus
                scale="lg"
                className="h-14 flex-1 text-lg"
                value={moneyAmount}
                onChange={(e) => setMoneyAmount(e.target.value)}
              />
              {operatorPoints.length <= 1 && (
                <PressableScale>
                  <SaveButton className="h-14" onClick={submitMoneyForm} saved={moneyFormSaved} />
                </PressableScale>
              )}
            </div>
          </div>
          {operatorPoints.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="moneyPoint">{t.operatorApp.workTime.pointLabel}</Label>
              <Select
                value={moneyPointId}
                onValueChange={(v) => v && setMoneyPointId(v)}
                items={operatorPoints.map((p) => ({ value: p.id, label: p.name }))}
              >
                <SelectTrigger id="moneyPoint">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operatorPoints.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {moneyError && <p className="text-sm text-destructive">{moneyError}</p>}
          {operatorPoints.length > 1 && (
            <PressableScale>
              <SaveButton className="h-12 w-full" onClick={submitMoneyForm} saved={moneyFormSaved} />
            </PressableScale>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={carryoverOpen} onClose={() => setCarryoverOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.workTime.carryoverAddButton}</h2>
          <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.workTime.carryoverHint}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="carryoverAmount">{t.money.amountLabel}</Label>
            <MoneyInput
              id="carryoverAmount"
              autoFocus
              scale="lg"
              className="h-14 text-lg"
              value={carryoverAmount}
              onChange={(e) => setCarryoverAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="carryoverComment">{t.operatorApp.submit.commentPlaceholder}</Label>
            <Input
              id="carryoverComment"
              value={carryoverComment}
              onChange={(e) => setCarryoverComment(e.target.value)}
            />
          </div>
          {carryoverError && <p className="text-sm text-destructive">{carryoverError}</p>}
          <PressableScale>
            <SaveButton className="h-12 w-full" onClick={confirmCarryover} saved={carryoverSaved} />
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={editingShift !== null} onClose={() => setEditingShift(null)}>
        {editingShift && (
          <div className="flex flex-col gap-4 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.readings.editSheetTitle}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="editStart">{t.operatorApp.workTime.arrivedLabel}</Label>
                <TimeInput
                  id="editStart"
                  className="h-12"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="editEnd">{t.operatorApp.workTime.leftLabel}</Label>
                <TimeInput
                  id="editEnd"
                  className="h-12"
                  disabled={editingShift.open && !closeShiftToo}
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                />
              </div>
            </div>
            {editingShift.open && (
              <div className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-body-airbnb">{t.operatorApp.workTime.closeShiftToggleLabel}</div>
                  <div className="text-caption-airbnb">{t.operatorApp.workTime.closeShiftToggleHint}</div>
                </div>
                <Switch checked={closeShiftToo} onCheckedChange={setCloseShiftToo} className="shrink-0" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="editAdvance">{t.operatorApp.workTime.advanceFieldLabel}</Label>
                <MoneyInput
                  id="editAdvance"
                  className="h-12"
                  value={editAdvance}
                  onChange={(e) => setEditAdvance(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="editBonus">{t.operatorApp.workTime.bonusFieldLabel}</Label>
                <MoneyInput
                  id="editBonus"
                  className="h-12"
                  value={editBonus}
                  onChange={(e) => setEditBonus(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editReason">
                {t.readings.reasonLabel} <span className="font-normal text-muted-foreground">· {t.common.optional}</span>
              </Label>
              <Input id="editReason" value={editReason} onChange={(e) => setEditReason(e.target.value)} />
            </div>
            {editWarnings.map((w) => (
              <p key={w} className="rounded-control bg-warning/15 px-3 py-2 text-sm font-medium text-warning">
                {warningText(w)}
              </p>
            ))}
            {editError && <p className="text-sm text-destructive">{editError}</p>}

            {confirmDeleteShift && shifts[0]?.id === editingShift.id ? (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-body-airbnb">{t.operatorApp.workTime.deleteShiftConfirm}</p>
                <PressableScale>
                  <DeleteButton
                    className="h-12 w-full"
                    disabled={deletingShift}
                    onClick={deleteShift}
                    deleted={shiftDeleted}
                  />
                </PressableScale>
              </div>
            ) : (
              <div className="flex gap-2">
                {shifts[0]?.id === editingShift.id && (
                  <PressableScale>
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-12 shrink-0 gap-1.5 px-4"
                      onClick={() => setConfirmDeleteShift(true)}
                    >
                      <Trash2 className="size-4" />
                      {t.common.delete}
                    </Button>
                  </PressableScale>
                )}
                <PressableScale className="min-w-0 flex-1">
                  <SaveButton className="h-12 w-full" onClick={submitShiftEdit} saved={shiftSaved} />
                </PressableScale>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={editingMoneyOp !== null} onClose={() => setEditingMoneyOp(null)}>
        {editingMoneyOp && (
          <div className="flex flex-col gap-4 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {editingMoneyOp.type === "advance" ? t.operatorApp.workTime.advanceFieldLabel : t.operatorApp.workTime.bonusFieldLabel}
            </h2>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editMoneyOpAmount">{t.money.amountLabel}</Label>
              <div className="flex items-center gap-2">
                <MoneyInput
                  id="editMoneyOpAmount"
                  autoFocus
                  scale="lg"
                  className="h-14 flex-1 text-lg"
                  value={editMoneyOpAmount}
                  onChange={(e) => setEditMoneyOpAmount(e.target.value)}
                />
                <PressableScale>
                  <SaveButton className="h-14" onClick={submitMoneyOpEdit} saved={moneyOpSaved} />
                </PressableScale>
              </div>
            </div>
            {editMoneyOpError && <p className="text-sm text-destructive">{editMoneyOpError}</p>}

            {confirmDeleteMoneyOp ? (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-body-airbnb">{t.operatorApp.workTime.deleteMoneyOpConfirm}</p>
                <PressableScale>
                  <DeleteButton
                    className="h-12 w-full"
                    disabled={deletingMoneyOp}
                    onClick={deleteMoneyOp}
                    deleted={moneyOpDeleted}
                  />
                </PressableScale>
              </div>
            ) : (
              <div className="border-t border-border pt-4">
                <PressableScale>
                  <Button variant="destructive" className="w-full gap-1.5" onClick={() => setConfirmDeleteMoneyOp(true)}>
                    <Trash2 className="size-4" />
                    {t.common.delete}
                  </Button>
                </PressableScale>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}
