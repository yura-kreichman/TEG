"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Pencil, KeyRound, Pause, Play, Trash2, Plus, MapPin, Check, Palette, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { StatusChip } from "@/components/status-chip";
import { IconPickerSheet, AssetOrZoneIcon } from "@/components/icon-picker";
import { ColorTagPicker } from "@/components/color-tag-picker";
import { useI18n } from "@/components/i18n-provider";
import { compressImageFile } from "@/lib/client-image";
import { colorTagGradient } from "@/lib/utils";

interface OperatorInfo {
  id: string;
  name: string;
  active: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  colorTag: string | null;
  allZonesAccess: boolean;
  allowedZones: { id: string; name: string }[];
}

interface ZoneOption {
  id: string;
  name: string;
  pointId: string;
  pointName: string;
}

type KebabView = "menu" | "rename" | "pin" | "zones" | "color" | "confirm-delete";

export default function OperatorsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [operators, setOperators] = useState<OperatorInfo[]>([]);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [kebab, setKebab] = useState<OperatorInfo | null>(null);
  const [kebabView, setKebabView] = useState<KebabView>("menu");
  const [renameValue, setRenameValue] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [colorValue, setColorValue] = useState("#22c55e");
  const [actionError, setActionError] = useState<string | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const [allZones, setAllZones] = useState<ZoneOption[]>([]);
  const [zoneAccessAll, setZoneAccessAll] = useState(true);
  const [zoneAccessSelected, setZoneAccessSelected] = useState<Set<string>>(new Set());

  async function loadOperators() {
    const res = await fetch("/api/operators");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setOperators(data.operators ?? []);
    setChecking(false);
  }

  async function loadZones() {
    const res = await fetch("/api/zones");
    if (!res.ok) return;
    const data = await res.json();
    setAllZones(data.zones ?? []);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadOperators();
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^\d{4,6}$/.test(pin)) {
      setError(t.operators.pinFormatError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/operators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось создать оператора");
        return;
      }

      setName("");
      setPin("");
      setCreateOpen(false);
      await loadOperators();
    } finally {
      setLoading(false);
    }
  }

  function openKebab(operator: OperatorInfo) {
    setKebab(operator);
    setKebabView("menu");
    setRenameValue(operator.name);
    setPinValue("");
    setColorValue(operator.colorTag ?? "#22c55e");
    setActionError(null);
    setZoneAccessAll(operator.allZonesAccess);
    setZoneAccessSelected(new Set(operator.allowedZones.map((z) => z.id)));
  }

  async function confirmColor() {
    if (!kebab) return;
    await fetch(`/api/operators/${kebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorTag: colorValue }),
    });
    setKebab(null);
    await loadOperators();
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
    if (!kebab) return;
    const res = await fetch(`/api/operators/${kebab.id}`, {
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
    setKebab(null);
    await loadOperators();
  }

  async function handleToggleActive() {
    if (!kebab) return;
    if (kebab.active) {
      await fetch(`/api/operators/${kebab.id}/deactivate`, { method: "POST" });
    } else {
      await fetch(`/api/operators/${kebab.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
    }
    setKebab(null);
    await loadOperators();
  }

  async function confirmRename() {
    if (!kebab || !renameValue.trim()) return;
    await fetch(`/api/operators/${kebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue }),
    });
    setKebab(null);
    await loadOperators();
  }

  async function confirmResetPin() {
    if (!kebab) return;
    if (!/^\d{4,6}$/.test(pinValue)) {
      setActionError(t.operators.pinFormatError);
      return;
    }
    const res = await fetch(`/api/operators/${kebab.id}/reset-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinValue }),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? "Не удалось сменить ПИН-код");
      return;
    }
    setKebab(null);
    await loadOperators();
  }

  async function confirmDelete() {
    if (!kebab) return;
    const res = await fetch(`/api/operators/${kebab.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? "Не удалось удалить оператора");
      return;
    }
    setKebab(null);
    await loadOperators();
  }

  async function handleUploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !kebab) return;
    const compressed = await compressImageFile(file, { maxDimension: 640, maxBytes: 120 * 1024 });
    const formData = new FormData();
    formData.append("file", compressed);
    const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
      setActionError(uploadData.error ?? "Не удалось загрузить фото");
      return;
    }
    await fetch(`/api/operators/${kebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: uploadData.url }),
    });
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    setKebab(null);
    await loadOperators();
  }

  async function handleChooseAvatarIcon(iconKey: string) {
    if (!kebab) return;
    await fetch(`/api/operators/${kebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iconKey }),
    });
    setAvatarPickerOpen(false);
    setKebab(null);
    await loadOperators();
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.operators.title}</h1>
            <PressableScale>
              <Button variant="dark" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t.common.add}
              </Button>
            </PressableScale>
          </div>

          {operators.length === 0 ? (
            <p className="mt-4 text-body-airbnb text-muted-foreground">{t.operators.noOperators}</p>
          ) : (
            <StaggerList className="mt-4 flex flex-col gap-3.5">
              {operators.map((operator) => (
                <StaggerItem key={operator.id}>
                  <PressableScale>
                    <SpringCard
                      animate={false}
                      className="cursor-pointer"
                      onClick={() => router.push(`/operators/${operator.id}`)}
                      style={{ background: colorTagGradient(operator.colorTag) }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                          {operator.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={operator.avatarUrl} alt="" className="size-12.5 rounded-full object-cover" />
                          ) : operator.iconKey ? (
                            <div className="flex size-12.5 items-center justify-center rounded-full bg-primary/10">
                              <AssetOrZoneIcon iconKey={operator.iconKey} className="size-7" />
                            </div>
                          ) : (
                            <div className="flex size-12.5 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                              {operator.name.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          {operator.colorTag && (
                            <span
                              className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-card"
                              style={{ backgroundColor: operator.colorTag }}
                            />
                          )}
                        </div>
                        <div className="min-w-0 grow">
                          <div className="text-card-title">{operator.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusChip variant={operator.active ? "accent" : "warning"}>
                              {operator.active ? t.operators.active : t.operators.inactive}
                            </StatusChip>
                            {operator.allZonesAccess ? (
                              <StatusChip variant="accent">{t.operators.allZonesChip}</StatusChip>
                            ) : operator.allowedZones.length > 0 ? (
                              <StatusChip variant="accent">
                                {operator.allowedZones.map((z) => z.name).join(", ")}
                              </StatusChip>
                            ) : (
                              <StatusChip variant="warning">{t.operators.noZoneAccessChip}</StatusChip>
                            )}
                          </div>
                        </div>
                        <div onClick={(e) => e.stopPropagation()}>
                          <KebabButton onClick={() => openKebab(operator)} label={t.operators.actionsLabel} />
                        </div>
                      </div>
                    </SpringCard>
                  </PressableScale>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.newOperatorTitle}</h2>
            <p className="text-caption-airbnb">{t.operators.newOperatorSub}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="name">{t.operators.nameLabel}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pin">{t.operators.pinLabel}</Label>
            <Input
              id="pin"
              inputMode="numeric"
              pattern="\d{4,6}"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <PressableScale>
            <Button type="submit" disabled={loading} className="w-full">
              {t.operators.addButton}
            </Button>
          </PressableScale>
        </form>
      </BottomSheet>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleUploadAvatar}
      />

      <BottomSheet open={kebab !== null} onClose={() => setKebab(null)}>
        {kebab && kebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[19px] font-extrabold tracking-[-0.01em]">{kebab.name}</h2>
            <ActionSheetItem icon={ImagePlus} onClick={() => avatarInputRef.current?.click()}>
              {t.operators.uploadAvatar}
            </ActionSheetItem>
            <ActionSheetItem icon={Smile} onClick={() => setAvatarPickerOpen(true)}>
              {t.operators.chooseAvatarAction}
            </ActionSheetItem>
            <ActionSheetItem icon={Pencil} onClick={() => setKebabView("rename")}>
              {t.operators.rename}
            </ActionSheetItem>
            <ActionSheetItem icon={KeyRound} onClick={() => setKebabView("pin")}>
              {t.operators.resetPin}
            </ActionSheetItem>
            <ActionSheetItem icon={MapPin} onClick={() => setKebabView("zones")}>
              {t.operators.zoneAccess}
            </ActionSheetItem>
            <ActionSheetItem icon={Palette} onClick={() => setKebabView("color")}>
              {t.operators.colorTagAction}
            </ActionSheetItem>
            <ActionSheetItem icon={kebab.active ? Pause : Play} destructive={kebab.active} onClick={handleToggleActive}>
              {kebab.active ? t.operators.deactivate : t.operators.activate}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setKebabView("confirm-delete")}>
              {t.operators.deleteButton}
            </ActionSheetItem>
            {actionError && <p className="mt-2 text-sm text-destructive">{actionError}</p>}
          </div>
        )}
        {kebab && kebabView === "rename" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.rename}</h2>
            <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button className="w-full" onClick={confirmRename}>
                  {t.common.save}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
        {kebab && kebabView === "pin" && (
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
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button className="w-full" onClick={confirmResetPin}>
                  {t.common.save}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
        {kebab && kebabView === "zones" && (
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
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button className="w-full" onClick={confirmZoneAccess}>
                  {t.common.save}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
        {kebab && kebabView === "color" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.colorTagAction}</h2>
            <ColorTagPicker value={colorValue} onChange={setColorValue} />
            <span className="text-caption-airbnb">{t.operators.colorTagHint}</span>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button className="w-full" onClick={confirmColor}>
                  {t.common.save}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
        {kebab && kebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.deleteButton}</h2>
            <p className="text-body-airbnb">{t.operators.confirmDelete}</p>
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button variant="destructive" className="w-full" onClick={confirmDelete}>
                  {t.common.delete}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      <IconPickerSheet
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        value={kebab?.iconKey}
        onChange={handleChooseAvatarIcon}
        families={["avatars"]}
      />
    </OwnerShell>
  );
}
