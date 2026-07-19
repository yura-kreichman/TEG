"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Camera,
  ImagePlus,
  Smile,
  Pencil,
  KeyRound,
  MapPin,
  DollarSign,
  Clock,
  Palette,
  Wallet,
  Power,
  PowerOff,
  Trash2,
  AlarmClockOff,
  PenLine,
  Fingerprint,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StatusChip } from "@/components/status-chip";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ActionSheetItem } from "@/components/kebab-menu";
import { IconPickerSheet, AssetOrZoneIcon } from "@/components/icon-picker";
import { ColorTagPicker } from "@/components/color-tag-picker";
import { OpenShiftBadge } from "@/components/open-shift-badge";
import { useI18n } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { compressImageFile } from "@/lib/client-image";
import { cn } from "@/lib/utils";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface Profile {
  id: string;
  name: string;
  active: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  colorTag: string | null;
  pin: string | null;
  allZonesAccess: boolean;
  allowedZones: { id: string; name: string }[];
  timeTrackingMode: "manual" | "auto";
  overdraftAllowed: boolean;
  skipShiftStartWindow: boolean;
  goodsAccess: boolean;
  revisionAccess: boolean;
  hasOpenShift: boolean;
}

interface ZoneOption {
  id: string;
  name: string;
  pointId: string;
  pointName: string;
}

// Строка со значением справа + шеврон (docs/spec/05-work-time.md, "Настройки
// оператора") — тап открывает bottom sheet редактирования этого поля.
function SettingsRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-t border-border py-3.5 text-left first:border-t-0"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-body-airbnb">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-body-airbnb text-muted-foreground">
        {value}
        <ChevronRight className="size-4" />
      </span>
    </button>
  );
}

export default function OperatorSettingsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [moduleEnabled, setModuleEnabled] = useState(false);
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [allZones, setAllZones] = useState<ZoneOption[]>([]);

  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const { saved: renameSaved, pulse: renamePulse } = useSavePulse();
  const [pinOpen, setPinOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const { saved: pinSaved, pulse: pinPulse } = useSavePulse();
  const [zonesOpen, setZonesOpen] = useState(false);
  const [zoneAccessAll, setZoneAccessAll] = useState(true);
  const [zoneAccessSelected, setZoneAccessSelected] = useState<Set<string>>(new Set());
  const [rateOpen, setRateOpen] = useState(false);
  const [rateValue, setRateValue] = useState("");
  const { saved: rateSaved, pulse: ratePulse } = useSavePulse();
  const [colorOpen, setColorOpen] = useState(false);
  const [colorValue, setColorValue] = useState("#22c55e");
  const { saved: colorSaved, pulse: colorPulse } = useSavePulse();
  const { saved: operatorDeleted, pulse: operatorDeletePulse } = useSavePulse();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [savingTimeTrackingMode, setSavingTimeTrackingMode] = useState(false);
  const [timeTrackingError, setTimeTrackingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadAll() {
    const [profileRes, summaryRes, zonesRes] = await Promise.all([
      fetch(`/api/operators/${params.id}`),
      fetch(`/api/operators/${params.id}/work-time/summary`),
      fetch("/api/zones"),
    ]);
    if (profileRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (!profileRes.ok) {
      router.replace("/operators");
      return;
    }
    const profileData: Profile = await profileRes.json();
    setProfile(profileData);
    setModuleEnabled(summaryRes.ok);
    if (summaryRes.ok) setCurrentRate((await summaryRes.json()).currentRate);
    if (zonesRes.ok) setAllZones((await zonesRes.json()).zones ?? []);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openRename() {
    if (!profile) return;
    setRenameValue(profile.name);
    setActionError(null);
    setRenameOpen(true);
  }

  async function confirmRename() {
    if (!profile || !renameValue.trim()) return;
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue }),
    });
    await loadAll();
    renamePulse(() => setRenameOpen(false));
  }

  function openPin() {
    setPinValue("");
    setActionError(null);
    setPinOpen(true);
  }

  async function confirmResetPin() {
    if (!/^\d{4,6}$/.test(pinValue)) {
      setActionError(t.operators.pinFormatError);
      return;
    }
    const res = await fetch(`/api/operators/${params.id}/reset-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinValue }),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? t.operators.pinFormatError);
      return;
    }
    pinPulse(() => setPinOpen(false));
  }

  function openZones() {
    if (!profile) return;
    setZoneAccessAll(profile.allZonesAccess);
    setZoneAccessSelected(new Set(profile.allowedZones.map((z) => z.id)));
    setActionError(null);
    setZonesOpen(true);
  }

  // Сохранение налету (фидбек 2026-07-14) — каждый переключатель сразу
  // отправляет PATCH, отдельной кнопки "Сохранить" в этом bottom sheet нет.
  async function saveZoneAccess(nextAll: boolean, nextSelected: Set<string>) {
    const res = await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allZonesAccess: nextAll,
        zoneIds: nextAll ? [] : [...nextSelected],
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? "Не удалось сохранить доступ к зонам");
      return;
    }
    setActionError(null);
    await loadAll();
  }

  function handleZoneAccessAllChange(value: boolean) {
    setZoneAccessAll(value);
    saveZoneAccess(value, zoneAccessSelected);
  }

  function toggleZoneSelected(zoneId: string) {
    const next = new Set(zoneAccessSelected);
    if (next.has(zoneId)) next.delete(zoneId);
    else next.add(zoneId);
    setZoneAccessSelected(next);
    saveZoneAccess(zoneAccessAll, next);
  }

  function openRate() {
    setRateValue(currentRate !== null ? String(currentRate) : "");
    setActionError(null);
    setRateOpen(true);
  }

  async function confirmRate() {
    const res = await fetch(`/api/operators/${params.id}/work-time/rate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate: Number(rateValue) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error ?? t.operatorApp.workTime.saveError);
      return;
    }
    await loadAll();
    ratePulse(() => setRateOpen(false));
  }

  async function setTimeTrackingMode(mode: "manual" | "auto") {
    if (!profile || profile.timeTrackingMode === mode) return;
    setTimeTrackingError(null);
    setSavingTimeTrackingMode(true);
    try {
      const res = await fetch(`/api/operators/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeTrackingMode: mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTimeTrackingError(data.error ?? t.operatorApp.workTime.saveError);
        return;
      }
      setProfile({ ...profile, timeTrackingMode: mode });
    } finally {
      setSavingTimeTrackingMode(false);
    }
  }

  async function toggleOverdraft(value: boolean) {
    if (!profile) return;
    setProfile({ ...profile, overdraftAllowed: value });
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overdraftAllowed: value }),
    });
  }

  async function toggleSkipShiftStartWindow(value: boolean) {
    if (!profile) return;
    setProfile({ ...profile, skipShiftStartWindow: value });
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skipShiftStartWindow: value }),
    });
  }

  // Тумблер модуля "Товары" (docs/spec/09-goods.md, "Доступ") — группа
  // "Работа", тот же принцип мгновенного сохранения, что overdraft/skip выше.
  async function toggleGoodsAccess(value: boolean) {
    if (!profile) return;
    setProfile({ ...profile, goodsAccess: value });
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goodsAccess: value }),
    });
  }

  // Отдельный тумблер ревизии остатков (запрос пользователя 2026-07-19) —
  // виден только при включённом goodsAccess (без него раздел "Товары" не
  // открыть вовсе, тумблер сам по себе не имеет смысла).
  async function toggleRevisionAccess(value: boolean) {
    if (!profile) return;
    setProfile({ ...profile, revisionAccess: value });
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionAccess: value }),
    });
  }

  function openColor() {
    if (!profile) return;
    setColorValue(profile.colorTag ?? "#22c55e");
    setColorOpen(true);
  }

  async function confirmColor() {
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorTag: colorValue }),
    });
    await loadAll();
    colorPulse(() => setColorOpen(false));
  }

  async function handleToggleActive() {
    if (!profile) return;
    if (profile.active) {
      await fetch(`/api/operators/${params.id}/deactivate`, { method: "POST" });
    } else {
      await fetch(`/api/operators/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
    }
    await loadAll();
  }

  async function confirmDelete() {
    const res = await fetch(`/api/operators/${params.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? "Не удалось удалить оператора");
      return;
    }
    operatorDeletePulse(() => router.replace("/operators"));
  }

  async function handleUploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const compressed = await compressImageFile(file, { maxDimension: 640, maxBytes: 120 * 1024 });
    const formData = new FormData();
    formData.append("file", compressed);
    const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
      setActionError(uploadData.error ?? "Не удалось загрузить фото");
      return;
    }
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: uploadData.url }),
    });
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    setAvatarSheetOpen(false);
    await loadAll();
  }

  async function handleChooseAvatarIcon(iconKey: string) {
    await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iconKey }),
    });
    setAvatarPickerOpen(false);
    setAvatarSheetOpen(false);
    await loadAll();
  }

  if (checking || !profile) return null;

  // Заголовок с названием точки над списком зон имеет смысл, только если
  // точек больше одной (запрос пользователя 2026-07-14 — и так ясно, если
  // она одна).
  const showPointName = new Set(allZones.map((zone) => zone.pointId)).size > 1;

  return (
    <OwnerShell>
    <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
      <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/operators/${params.id}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <h1 className="text-screen-title">{t.operators.settingsTitle}</h1>
        </div>

        <SpringCard hover={false} className="relative flex flex-col items-center gap-2 text-center">
          {profile.hasOpenShift && profile.timeTrackingMode === "auto" && (
            <OpenShiftBadge className="top-3 right-3 bottom-auto" />
          )}
          <button type="button" onClick={() => setAvatarSheetOpen(true)} className="relative">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="size-20 rounded-full object-cover" />
            ) : profile.iconKey ? (
              <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
                <AssetOrZoneIcon iconKey={profile.iconKey} className="size-18" />
              </div>
            ) : (
              <div className="flex size-20 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                {profile.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex size-6.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
              <Camera className="size-3.5" />
            </span>
          </button>
          <button type="button" onClick={openRename} className="flex items-center gap-1.5">
            <span className="text-card-title">{profile.name}</span>
            <Pencil className="size-3.5 text-muted-foreground" />
          </button>
          <span className="text-caption-airbnb text-muted-foreground">
            {profile.active ? t.operators.active : t.operators.inactive}
          </span>
        </SpringCard>

        <SpringCard hover={false} className="flex flex-col">
          <span className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[.08em] text-muted-foreground/70">
            {t.operators.accessGroupLabel}
          </span>
          <SettingsRow
            icon={KeyRound}
            label={t.operators.pinRowLabel}
            value={profile.pin ?? "••••"}
            onClick={openPin}
          />
          <button
            type="button"
            onClick={openZones}
            className="flex w-full flex-col gap-2 border-t border-border py-3.5 text-left"
          >
            <span className="flex items-center gap-3">
              <MapPin className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-body-airbnb">{t.operators.zoneAccess}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </span>
            <span className="pl-7">
              {profile.allZonesAccess ? (
                <StatusChip variant="accent">{t.operators.allZonesChip}</StatusChip>
              ) : profile.allowedZones.length > 0 ? (
                <StatusChip variant="accent">{profile.allowedZones.map((z) => z.name).join(", ")}</StatusChip>
              ) : (
                <StatusChip variant="warning">{t.operators.noZoneAccessChip}</StatusChip>
              )}
            </span>
          </button>
        </SpringCard>

        {moduleEnabled && (
          <SpringCard hover={false} className="flex flex-col">
            <span className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[.08em] text-muted-foreground/70">
              {t.operators.workGroupLabel}
            </span>
            <SettingsRow
              icon={DollarSign}
              label={t.operatorApp.workTime.rateLabel}
              value={currentRate !== null ? <Money value={currentRate} /> : "—"}
              onClick={openRate}
            />
            <div className="flex items-center gap-3 border-t border-border py-3.5">
              <Clock className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-body-airbnb">{t.operatorApp.workTime.timeTrackingModeLabel}</div>
                <div className="text-caption-airbnb">{t.operators.timeTrackingModeHint}</div>
              </div>
              <div className="flex shrink-0 overflow-hidden rounded-control border border-border bg-muted shadow-[inset_0_1px_2px_rgba(0,0,0,.08)]">
                <button
                  type="button"
                  disabled={savingTimeTrackingMode}
                  onClick={() => setTimeTrackingMode("manual")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50",
                    profile.timeTrackingMode === "manual"
                      ? "bg-linear-to-b from-primary to-[color-mix(in_oklch,var(--primary),black_14%)] text-primary-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,.18)]"
                      : "bg-transparent"
                  )}
                >
                  <PenLine className="size-3.5 shrink-0" />
                  {t.operatorApp.workTime.timeTrackingModeManual}
                </button>
                <button
                  type="button"
                  disabled={savingTimeTrackingMode}
                  onClick={() => setTimeTrackingMode("auto")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50",
                    profile.timeTrackingMode === "auto"
                      ? "bg-linear-to-b from-primary to-[color-mix(in_oklch,var(--primary),black_14%)] text-primary-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,.18)]"
                      : "bg-transparent"
                  )}
                >
                  <Fingerprint className="size-3.5 shrink-0" />
                  {t.operatorApp.workTime.timeTrackingModeAuto}
                </button>
              </div>
            </div>
            {timeTrackingError && (
              <p className="border-t border-border py-2 text-caption-airbnb text-destructive">{timeTrackingError}</p>
            )}
            <div className="flex items-center gap-3 border-t border-border py-3.5">
              <Wallet className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-body-airbnb">{t.operators.overdraftLabel}</div>
                <div className="text-caption-airbnb">{t.operators.overdraftHint}</div>
              </div>
              <Switch checked={profile.overdraftAllowed} onCheckedChange={toggleOverdraft} className="shrink-0" />
            </div>
            {profile.timeTrackingMode === "auto" && (
              <div className="flex items-center gap-3 border-t border-border py-3.5">
                <AlarmClockOff className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-body-airbnb">{t.operators.skipShiftStartWindowLabel}</div>
                  <div className="text-caption-airbnb">{t.operators.skipShiftStartWindowHint}</div>
                </div>
                <Switch
                  checked={profile.skipShiftStartWindow}
                  onCheckedChange={toggleSkipShiftStartWindow}
                  className="shrink-0"
                />
              </div>
            )}
            <div className="flex items-center gap-3 border-t border-border py-3.5">
              <ShoppingBag className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-body-airbnb">{t.goods.navLabel}</div>
                <div className="text-caption-airbnb">{t.operators.goodsAccessHint}</div>
              </div>
              <Switch checked={profile.goodsAccess} onCheckedChange={toggleGoodsAccess} className="shrink-0" />
            </div>
            {/* Без своей border-t и без иконки (запрос пользователя
                2026-07-19: "надо, чтобы было понятно, что Ревизия относится
                к Товарам... не разделять линией") — визуально приклеена к
                строке "Товары" выше и слегка сдвинута вправо (pl-7, под
                текст, а не под иконку), читается как её под-настройка, а не
                независимый пункт. */}
            {profile.goodsAccess && (
              <div className="flex items-center gap-3 py-2.5 pl-7">
                <div className="min-w-0 flex-1">
                  <div className="text-caption-airbnb font-semibold">{t.goods.revisionTitle}</div>
                  <div className="text-caption-airbnb text-muted-foreground">{t.operators.revisionAccessHint}</div>
                </div>
                <Switch checked={profile.revisionAccess} onCheckedChange={toggleRevisionAccess} className="shrink-0" />
              </div>
            )}
            <SettingsRow
              icon={Palette}
              label={t.operators.colorTagAction}
              value={
                <span
                  className="size-5 rounded-full border border-black/10"
                  style={{ backgroundColor: profile.colorTag ?? "transparent" }}
                />
              }
              onClick={openColor}
            />
          </SpringCard>
        )}

        {!moduleEnabled && (
          <SpringCard hover={false} className="flex flex-col">
            <span className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[.08em] text-muted-foreground/70">
              {t.operators.workGroupLabel}
            </span>
            <div className="flex items-center gap-3 border-t border-border py-3.5 first:border-t-0">
              <ShoppingBag className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-body-airbnb">{t.goods.navLabel}</div>
                <div className="text-caption-airbnb">{t.operators.goodsAccessHint}</div>
              </div>
              <Switch checked={profile.goodsAccess} onCheckedChange={toggleGoodsAccess} className="shrink-0" />
            </div>
            {/* Без своей border-t и без иконки (запрос пользователя
                2026-07-19: "надо, чтобы было понятно, что Ревизия относится
                к Товарам... не разделять линией") — визуально приклеена к
                строке "Товары" выше и слегка сдвинута вправо (pl-7, под
                текст, а не под иконку), читается как её под-настройка, а не
                независимый пункт. */}
            {profile.goodsAccess && (
              <div className="flex items-center gap-3 py-2.5 pl-7">
                <div className="min-w-0 flex-1">
                  <div className="text-caption-airbnb font-semibold">{t.goods.revisionTitle}</div>
                  <div className="text-caption-airbnb text-muted-foreground">{t.operators.revisionAccessHint}</div>
                </div>
                <Switch checked={profile.revisionAccess} onCheckedChange={toggleRevisionAccess} className="shrink-0" />
              </div>
            )}
            <SettingsRow
              icon={Palette}
              label={t.operators.colorTagAction}
              value={
                <span
                  className="size-5 rounded-full border border-black/10"
                  style={{ backgroundColor: profile.colorTag ?? "transparent" }}
                />
              }
              onClick={openColor}
            />
          </SpringCard>
        )}

        {actionError && <p className="text-center text-sm text-destructive">{actionError}</p>}

        {profile.active && profile.hasOpenShift && (
          <p className="text-center text-caption-airbnb text-warning">{t.operators.deactivateOpenShiftWarning}</p>
        )}

        <div className="mt-2 flex gap-2">
          <PressableScale className="flex-1">
            <Button
              type="button"
              variant={profile.active ? "destructive" : "default"}
              size="sm"
              className="w-full gap-1.5"
              onClick={handleToggleActive}
            >
              {profile.active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
              {profile.active ? t.operators.deactivateOperatorButton : t.operators.activateOperatorButton}
            </Button>
          </PressableScale>
          <PressableScale className="flex-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              {t.operators.deleteButton}
            </Button>
          </PressableScale>
        </div>
      </div>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleUploadAvatar}
      />

      <BottomSheet open={avatarSheetOpen} onClose={() => setAvatarSheetOpen(false)}>
        <div className="pt-2">
          <ActionSheetItem icon={ImagePlus} onClick={() => avatarInputRef.current?.click()}>
            {t.operators.uploadAvatar}
          </ActionSheetItem>
          <ActionSheetItem icon={Smile} onClick={() => setAvatarPickerOpen(true)}>
            {t.operators.chooseAvatarAction}
          </ActionSheetItem>
        </div>
      </BottomSheet>

      <IconPickerSheet
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        value={profile.iconKey}
        onChange={handleChooseAvatarIcon}
        families={["avatars"]}
      />

      <BottomSheet open={renameOpen} onClose={() => setRenameOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operators.rename}</h2>
          <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          <PressableScale>
            <SaveButton className="h-12 w-full" onClick={confirmRename} saved={renameSaved} />
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={pinOpen} onClose={() => setPinOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operators.resetPin}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pinValue">{t.operators.resetPinPrompt}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="pinValue"
                autoFocus
                inputMode="numeric"
                pattern="\d{4,6}"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                className="h-14 flex-1 text-lg tabular-nums"
              />
              <PressableScale>
                <SaveButton className="h-14" onClick={confirmResetPin} saved={pinSaved} />
              </PressableScale>
            </div>
          </div>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        </div>
      </BottomSheet>

      <BottomSheet open={zonesOpen} onClose={() => setZonesOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operators.zoneAccessTitle}</h2>
          <div className="flex w-full items-center justify-between border-t border-border py-3.5 text-body-airbnb first:border-t-0">
            {t.operators.allZonesLabel}
            <Switch checked={zoneAccessAll} onCheckedChange={handleZoneAccessAllChange} />
          </div>
          {!zoneAccessAll && (
            <div className="-mt-1 max-h-72 overflow-y-auto">
              {Object.entries(
                allZones.reduce<Record<string, ZoneOption[]>>((acc, zone) => {
                  (acc[zone.pointName] ??= []).push(zone);
                  return acc;
                }, {})
              ).map(([pointName, zones]) => (
                <div key={pointName}>
                  {showPointName && <p className="pt-2 text-section-title">{pointName}</p>}
                  {zones.map((zone) => (
                    <div
                      key={zone.id}
                      className="flex w-full items-center justify-between border-t border-border py-3.5 text-body-airbnb first:border-t-0"
                    >
                      {zone.name}
                      <Switch
                        checked={zoneAccessSelected.has(zone.id)}
                        onCheckedChange={() => toggleZoneSelected(zone.id)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        </div>
      </BottomSheet>

      <BottomSheet open={rateOpen} onClose={() => setRateOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.workTime.changeRateTitle}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rateValue">{t.operatorApp.workTime.rateLabel}</Label>
            <div className="flex items-center gap-2">
              <MoneyInput
                id="rateValue"
                autoFocus
                scale="lg"
                className="h-14 flex-1 text-lg"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
              />
              <PressableScale>
                <SaveButton className="h-14" onClick={confirmRate} saved={rateSaved} />
              </PressableScale>
            </div>
          </div>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        </div>
      </BottomSheet>

      <BottomSheet open={colorOpen} onClose={() => setColorOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operators.colorTagAction}</h2>
          <ColorTagPicker value={colorValue} onChange={setColorValue} />
          <span className="text-caption-airbnb">{t.operators.colorTagHint}</span>
          <PressableScale>
            <SaveButton className="h-12 w-full" onClick={confirmColor} saved={colorSaved} />
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operators.deleteButton}</h2>
          <p className="text-body-airbnb">{t.operators.confirmDelete}</p>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={confirmDelete} deleted={operatorDeleted} />
          </PressableScale>
        </div>
      </BottomSheet>
    </div>
    </OwnerShell>
  );
}
