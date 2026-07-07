"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Link2, ImagePlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconPicker, IconPickerSheet } from "@/components/icon-picker";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { StatusChip } from "@/components/status-chip";
import { TileIcon } from "@/components/tile-icon";
import { QrCode } from "@/components/qr-code";
import { useI18n } from "@/components/i18n-provider";

interface PointDeviceInfo {
  id: string;
  label: string | null;
  activated: boolean;
  roaming: boolean;
}

interface PointInfo {
  id: string;
  name: string;
  address: string | null;
  iconKey: string | null;
  zonesCount: number;
  devices: PointDeviceInfo[];
}

type PointKebabView = "menu" | "rename" | "icon" | "confirm-delete";
type DeviceKebabView = "menu" | "rename" | "confirm-delete";

export default function PointsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [points, setPoints] = useState<PointInfo[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [iconKey, setIconKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [deviceSheetPointId, setDeviceSheetPointId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [deviceRoaming, setDeviceRoaming] = useState(false);
  const [installLinks, setInstallLinks] = useState<Record<string, string>>({});
  const [qrOpenFor, setQrOpenFor] = useState<string | null>(null);

  const [pointKebab, setPointKebab] = useState<PointInfo | null>(null);
  const [pointKebabView, setPointKebabView] = useState<PointKebabView>("menu");
  const [renamePointValue, setRenamePointValue] = useState("");
  const [pointActionError, setPointActionError] = useState<string | null>(null);

  const [deviceKebab, setDeviceKebab] = useState<{ pointId: string; device: PointDeviceInfo } | null>(null);
  const [deviceKebabView, setDeviceKebabView] = useState<DeviceKebabView>("menu");
  const [renameDeviceValue, setRenameDeviceValue] = useState("");

  async function loadPoints() {
    const res = await fetch("/api/points");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setPoints(data.points ?? []);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, iconKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось создать точку");
        return;
      }
      setName("");
      setAddress("");
      setIconKey(null);
      setCreateOpen(false);
      await loadPoints();
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateDevice(event: FormEvent) {
    event.preventDefault();
    if (!deviceSheetPointId) return;
    const res = await fetch(`/api/points/${deviceSheetPointId}/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: deviceLabel, roaming: deviceRoaming }),
    });
    const data = await res.json();
    if (res.ok) {
      setInstallLinks((prev) => ({ ...prev, [data.id]: data.installLink }));
      setDeviceLabel("");
      setDeviceRoaming(false);
      setDeviceSheetPointId(null);
      await loadPoints();
    }
  }

  function openPointKebab(point: PointInfo) {
    setPointKebab(point);
    setPointKebabView("menu");
    setRenamePointValue(point.name);
    setPointActionError(null);
  }

  async function confirmRenamePoint() {
    if (!pointKebab || !renamePointValue.trim()) return;
    await fetch(`/api/points/${pointKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renamePointValue }),
    });
    setPointKebab(null);
    await loadPoints();
  }

  async function handlePointIconChange(nextIconKey: string) {
    if (!pointKebab) return;
    await fetch(`/api/points/${pointKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iconKey: nextIconKey }),
    });
    setPointKebab(null);
    await loadPoints();
  }

  async function confirmDeletePoint() {
    if (!pointKebab) return;
    const res = await fetch(`/api/points/${pointKebab.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setPointActionError(data.error ?? "Не удалось удалить точку");
      return;
    }
    setPointKebab(null);
    await loadPoints();
  }

  function openDeviceKebab(pointId: string, device: PointDeviceInfo) {
    setDeviceKebab({ pointId, device });
    setDeviceKebabView("menu");
    setRenameDeviceValue(device.label ?? "");
  }

  async function confirmRenameDevice() {
    if (!deviceKebab) return;
    await fetch(`/api/points/${deviceKebab.pointId}/devices/${deviceKebab.device.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: renameDeviceValue }),
    });
    setDeviceKebab(null);
    await loadPoints();
  }

  async function copyActivationLink() {
    if (!deviceKebab) return;
    const link = installLinks[deviceKebab.device.id];
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setDeviceKebab(null);
  }

  async function confirmDeleteDevice() {
    if (!deviceKebab) return;
    const { pointId, device } = deviceKebab;
    await fetch(`/api/points/${pointId}/devices/${device.id}`, { method: "DELETE" });
    setInstallLinks((prev) => {
      const next = { ...prev };
      delete next[device.id];
      return next;
    });
    if (qrOpenFor === device.id) setQrOpenFor(null);
    setDeviceKebab(null);
    await loadPoints();
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.points.title}</h1>
            <PressableScale>
              <Button variant="dark" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t.common.add}
              </Button>
            </PressableScale>
          </div>
          <p className="mb-4 text-caption-airbnb">{t.points.pageSub}</p>

          {points.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.points.noPoints}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3.5">
              {points.map((point) => {
                const activatedCount = point.devices.filter((d) => d.activated).length;
                return (
                  <StaggerItem key={point.id}>
                    <SpringCard animate={false}>
                      <div className="flex items-center gap-3">
                        <TileIcon iconKey={point.iconKey} />
                        <div className="min-w-0 grow">
                          <Link href={`/points/${point.id}`} className="text-card-title hover:underline">
                            {point.name}
                          </Link>
                          <p className="text-caption-airbnb">
                            {point.zonesCount} {t.points.zonesSuffix}
                            {point.devices.length > 0 && (
                              <>
                                {" · "}
                                {activatedCount} {t.points.devicesActivatedText}
                              </>
                            )}
                          </p>
                        </div>
                        <KebabButton onClick={() => openPointKebab(point)} label={t.points.renamePoint} />
                      </div>

                      {point.devices.map((device) => (
                        <div key={device.id} className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5 text-body-airbnb">
                                {device.label ?? t.points.unnamedDevice}
                                {device.activated && <StatusChip>{t.points.deviceActivated}</StatusChip>}
                                {device.roaming && <StatusChip variant="warning">{t.points.roamingChip}</StatusChip>}
                              </div>
                              {!device.activated && (
                                <p className="text-caption-airbnb">{t.points.deviceAwaiting}</p>
                              )}
                            </div>
                            <KebabButton
                              onClick={() => openDeviceKebab(point.id, device)}
                              label={t.points.renameDevice}
                            />
                          </div>
                          {installLinks[device.id] && (
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                className="w-fit text-caption-airbnb font-semibold text-primary underline underline-offset-2"
                                onClick={() => setQrOpenFor(qrOpenFor === device.id ? null : device.id)}
                              >
                                {qrOpenFor === device.id ? t.points.hideQr : t.points.showQr}
                              </button>
                              {qrOpenFor === device.id && (
                                <QrCode value={installLinks[device.id]} alt={t.points.qrAlt} />
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      <button
                        type="button"
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-control border-[1.5px] border-dashed border-border py-2.5 text-body-airbnb font-semibold text-primary"
                        onClick={() => {
                          setDeviceSheetPointId(point.id);
                          setDeviceLabel("");
                          setDeviceRoaming(false);
                        }}
                      >
                        {t.points.addDeviceButton}
                      </button>
                    </SpringCard>
                  </StaggerItem>
                );
              })}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.points.newPointTitle}</h2>
            <p className="text-caption-airbnb">{t.points.newPointSub}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="name">{t.points.nameLabel}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="address">{t.points.addressLabel}</Label>
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t.points.iconLabel}</Label>
            <IconPicker value={iconKey} onChange={setIconKey} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <PressableScale>
            <Button type="submit" disabled={loading} className="w-full">
              {t.points.addButton}
            </Button>
          </PressableScale>
        </form>
      </BottomSheet>

      <BottomSheet open={deviceSheetPointId !== null} onClose={() => setDeviceSheetPointId(null)}>
        <form onSubmit={handleCreateDevice} className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.points.newDeviceTitle}</h2>
            <p className="text-caption-airbnb">{t.points.newDeviceSub}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              {t.points.deviceNameLabel} <span className="font-normal text-muted-foreground">· {t.common.optional}</span>
            </Label>
            <Input
              autoFocus
              placeholder={t.points.deviceLabelPlaceholder}
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setDeviceRoaming((prev) => !prev)}
            className="flex items-center justify-between rounded-control border border-border p-3 text-left"
          >
            <span>
              <span className="block text-body-airbnb">{t.points.roamingLabel}</span>
              <span className="mt-0.5 block text-caption-airbnb">{t.points.roamingHint}</span>
            </span>
            {deviceRoaming && <Check className="size-4 shrink-0 text-primary" />}
          </button>
          <PressableScale>
            <Button type="submit" className="w-full">
              {t.points.createDeviceLinkButton}
            </Button>
          </PressableScale>
        </form>
      </BottomSheet>

      <BottomSheet open={pointKebab !== null && pointKebabView !== "icon"} onClose={() => setPointKebab(null)}>
        {pointKebab && pointKebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[19px] font-extrabold tracking-[-0.01em]">{pointKebab.name}</h2>
            <ActionSheetItem icon={Pencil} onClick={() => setPointKebabView("rename")}>
              {t.points.renamePoint}
            </ActionSheetItem>
            <ActionSheetItem icon={ImagePlus} onClick={() => setPointKebabView("icon")}>
              {t.common.changeIcon}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setPointKebabView("confirm-delete")}>
              {t.points.deletePoint}
            </ActionSheetItem>
          </div>
        )}
        {pointKebab && pointKebabView === "rename" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.points.renamePoint}</h2>
            <Input autoFocus value={renamePointValue} onChange={(e) => setRenamePointValue(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPointKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button className="w-full" onClick={confirmRenamePoint}>
                  {t.common.save}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
        {pointKebab && pointKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.points.deletePoint}</h2>
            <p className="text-body-airbnb">{t.points.confirmDeletePoint}</p>
            {pointActionError && <p className="text-sm text-destructive">{pointActionError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPointKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button variant="destructive" className="w-full" onClick={confirmDeletePoint}>
                  {t.common.delete}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>
      {pointKebab && (
        <IconPickerSheet
          open={pointKebabView === "icon"}
          onClose={() => setPointKebabView("menu")}
          value={pointKebab.iconKey}
          onChange={handlePointIconChange}
        />
      )}

      <BottomSheet open={deviceKebab !== null} onClose={() => setDeviceKebab(null)}>
        {deviceKebab && deviceKebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[19px] font-extrabold tracking-[-0.01em]">
              {deviceKebab.device.label ?? t.points.unnamedDevice}
            </h2>
            <ActionSheetItem icon={Pencil} onClick={() => setDeviceKebabView("rename")}>
              {t.points.renameDevice}
            </ActionSheetItem>
            {installLinks[deviceKebab.device.id] && (
              <ActionSheetItem icon={Link2} onClick={copyActivationLink}>
                {t.points.copyActivationLink}
              </ActionSheetItem>
            )}
            <ActionSheetItem icon={Trash2} destructive onClick={() => setDeviceKebabView("confirm-delete")}>
              {t.points.deleteDevice}
            </ActionSheetItem>
          </div>
        )}
        {deviceKebab && deviceKebabView === "rename" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.points.renameDevice}</h2>
            <Input
              autoFocus
              placeholder={t.points.deviceLabelPlaceholder}
              value={renameDeviceValue}
              onChange={(e) => setRenameDeviceValue(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeviceKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button className="w-full" onClick={confirmRenameDevice}>
                  {t.common.save}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
        {deviceKebab && deviceKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.points.deleteDevice}</h2>
            <p className="text-body-airbnb">{t.points.confirmDeleteDevice}</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeviceKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <Button variant="destructive" className="w-full" onClick={confirmDeleteDevice}>
                  {t.common.delete}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}
