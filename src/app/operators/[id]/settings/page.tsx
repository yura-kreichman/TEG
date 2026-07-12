"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ActionSheetItem } from "@/components/kebab-menu";
import { IconPickerSheet, AssetOrZoneIcon } from "@/components/icon-picker";
import { ColorTagPicker } from "@/components/color-tag-picker";
import { useI18n } from "@/components/i18n-provider";
import { compressImageFile } from "@/lib/client-image";
import { cn } from "@/lib/utils";

interface Profile {
  id: string;
  name: string;
  active: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  colorTag: string | null;
  allZonesAccess: boolean;
  allowedZones: { id: string; name: string }[];
  timeTrackingMode: "manual" | "auto";
  overdraftAllowed: boolean;
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
  const [pinOpen, setPinOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [zonesOpen, setZonesOpen] = useState(false);
  const [zoneAccessAll, setZoneAccessAll] = useState(true);
  const [zoneAccessSelected, setZoneAccessSelected] = useState<Set<string>>(new Set());
  const [rateOpen, setRateOpen] = useState(false);
  const [rateValue, setRateValue] = useState("");
  const [colorOpen, setColorOpen] = useState(false);
  const [colorValue, setColorValue] = useState("#22c55e");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [savingTimeTrackingMode, setSavingTimeTrackingMode] = useState(false);
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
    setRenameOpen(false);
    await loadAll();
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
    setPinOpen(false);
  }

  function openZones() {
    if (!profile) return;
    setZoneAccessAll(profile.allZonesAccess);
    setZoneAccessSelected(new Set(profile.allowedZones.map((z) => z.id)));
    setActionError(null);
    setZonesOpen(true);
  }

  function toggleZoneSelected(zoneId: string) {
    setZoneAccessSelected((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }

  async function confirmZoneAccess() {
    const res = await fetch(`/api/operators/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allZonesAccess: zoneAccessAll,
        zoneIds: zoneAccessAll ? [] : [...zoneAccessSelected],
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? "Не удалось сохранить доступ к зонам");
      return;
    }
    setZonesOpen(false);
    await loadAll();
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
    setRateOpen(false);
    await loadAll();
  }

  async function setTimeTrackingMode(mode: "manual" | "auto") {
    if (!profile || profile.timeTrackingMode === mode) return;
    setActionError(null);
    setSavingTimeTrackingMode(true);
    try {
      const res = await fetch(`/api/operators/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeTrackingMode: mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? t.operatorApp.workTime.saveError);
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
    setColorOpen(false);
    await loadAll();
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
    router.replace("/operators");
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

  const zoneAccessValue = profile.allZonesAccess
    ? t.operators.allZonesLabel
    : profile.allowedZones.length > 0
      ? profile.allowedZones.map((z) => z.name).join(", ")
      : t.operators.noZoneAccessChip;

  return (
    <OwnerShell>
    <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/operators/${params.id}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <h1 className="text-screen-title">{t.operators.settingsTitle}</h1>
        </div>

        <SpringCard hover={false} className="flex flex-col items-center gap-2 text-center">
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
          <span className="mb-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground/70">
            {t.operators.accessGroupLabel}
          </span>
          <SettingsRow icon={KeyRound} label={t.operators.pinRowLabel} value="••••" onClick={openPin} />
          <SettingsRow icon={MapPin} label={t.operators.zoneAccess} value={zoneAccessValue} onClick={openZones} />
        </SpringCard>

        {moduleEnabled && (
          <SpringCard hover={false} className="flex flex-col">
            <span className="mb-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground/70">
              {t.operators.workGroupLabel}
            </span>
            <SettingsRow
              icon={DollarSign}
              label={t.operatorApp.workTime.rateLabel}
              value={currentRate !== null ? currentRate.toFixed(2) : "—"}
              onClick={openRate}
            />
            <div className="flex items-center gap-3 border-t border-border py-3.5">
              <Clock className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-body-airbnb">{t.operatorApp.workTime.timeTrackingModeLabel}</span>
              <div className="flex shrink-0 overflow-hidden rounded-control border border-border">
                <button
                  type="button"
                  disabled={savingTimeTrackingMode}
                  onClick={() => setTimeTrackingMode("manual")}
                  className={cn(
                    "px-3 py-1.5 text-caption-airbnb font-semibold transition-colors disabled:opacity-50",
                    profile.timeTrackingMode === "manual" ? "bg-primary text-primary-foreground" : "bg-transparent"
                  )}
                >
                  {t.operatorApp.workTime.timeTrackingModeManual}
                </button>
                <button
                  type="button"
                  disabled={savingTimeTrackingMode}
                  onClick={() => setTimeTrackingMode("auto")}
                  className={cn(
                    "px-3 py-1.5 text-caption-airbnb font-semibold transition-colors disabled:opacity-50",
                    profile.timeTrackingMode === "auto" ? "bg-primary text-primary-foreground" : "bg-transparent"
                  )}
                >
                  {t.operatorApp.workTime.timeTrackingModeAuto}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-border py-3.5">
              <Wallet className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-body-airbnb">{t.operators.overdraftLabel}</div>
                <div className="text-caption-airbnb">{t.operators.overdraftHint}</div>
              </div>
              <Switch checked={profile.overdraftAllowed} onCheckedChange={toggleOverdraft} className="shrink-0" />
            </div>
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
            <span className="mb-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground/70">
              {t.operators.workGroupLabel}
            </span>
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

        <div className="mt-2 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleToggleActive}
            className={cn("text-body-airbnb font-semibold", profile.active ? "text-destructive" : "text-primary")}
          >
            {profile.active ? t.operators.deactivateOperatorButton : t.operators.activateOperatorButton}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="text-caption-airbnb text-muted-foreground"
          >
            {t.operators.deleteButton}
          </button>
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
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.rename}</h2>
          <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          <PressableScale>
            <Button className="w-full" onClick={confirmRename}>
              {t.common.save}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={pinOpen} onClose={() => setPinOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.resetPin}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pinValue">{t.operators.resetPinPrompt}</Label>
            <Input
              id="pinValue"
              autoFocus
              inputMode="numeric"
              pattern="\d{4,6}"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              className="h-14 text-lg tabular-nums"
            />
          </div>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <PressableScale>
            <Button className="w-full" onClick={confirmResetPin}>
              {t.common.save}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={zonesOpen} onClose={() => setZonesOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.zoneAccessTitle}</h2>
          <button
            type="button"
            onClick={() => setZoneAccessAll((prev) => !prev)}
            className="flex w-full items-center justify-between border-t border-border py-3.5 text-left text-body-airbnb first:border-t-0"
          >
            {t.operators.allZonesLabel}
            {zoneAccessAll && <Check className="size-4 shrink-0 text-primary" />}
          </button>
          {!zoneAccessAll && (
            <div className="-mt-1 max-h-72 overflow-y-auto">
              {Object.entries(
                allZones.reduce<Record<string, ZoneOption[]>>((acc, zone) => {
                  (acc[zone.pointName] ??= []).push(zone);
                  return acc;
                }, {})
              ).map(([pointName, zones]) => (
                <div key={pointName}>
                  <p className="pt-2 text-section-title">{pointName}</p>
                  {zones.map((zone) => (
                    <button
                      key={zone.id}
                      type="button"
                      onClick={() => toggleZoneSelected(zone.id)}
                      className="flex w-full items-center justify-between border-t border-border py-3.5 text-left text-body-airbnb first:border-t-0"
                    >
                      {zone.name}
                      {zoneAccessSelected.has(zone.id) && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <PressableScale>
            <Button className="w-full" onClick={confirmZoneAccess}>
              {t.common.save}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={rateOpen} onClose={() => setRateOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operatorApp.workTime.changeRateTitle}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rateValue">{t.operatorApp.workTime.rateLabel}</Label>
            <Input
              id="rateValue"
              autoFocus
              inputMode="decimal"
              className="h-14 text-lg tabular-nums"
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
            />
          </div>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <PressableScale>
            <Button className="w-full" onClick={confirmRate}>
              {t.common.save}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={colorOpen} onClose={() => setColorOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.colorTagAction}</h2>
          <ColorTagPicker value={colorValue} onChange={setColorValue} />
          <span className="text-caption-airbnb">{t.operators.colorTagHint}</span>
          <PressableScale>
            <Button className="w-full" onClick={confirmColor}>
              {t.common.save}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.deleteButton}</h2>
          <p className="text-body-airbnb">{t.operators.confirmDelete}</p>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteOpen(false)}>
              {t.common.cancel}
            </Button>
            <PressableScale className="flex-1">
              <Button variant="destructive" className="w-full" onClick={confirmDelete}>
                {t.common.delete}
              </Button>
            </PressableScale>
          </div>
        </div>
      </BottomSheet>
    </div>
    </OwnerShell>
  );
}
