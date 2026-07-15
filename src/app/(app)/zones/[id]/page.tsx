"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Pencil, Camera, ImagePlus, ListChecks, Trash2, Plus, Pause, Play, ChevronDown, ChevronUp, Smile, X, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconPicker, IconPickerSheet, AssetOrZoneIcon } from "@/components/icon-picker";
import { EmojiPickerSheet } from "@/components/emoji-picker";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { StatusChip } from "@/components/status-chip";
import { TileIcon } from "@/components/tile-icon";
import { FilePickerButton } from "@/components/file-picker-button";
import { useI18n } from "@/components/i18n-provider";
import { compressImageFile } from "@/lib/client-image";
import { ZONE_ACCOUNTING_MODES, type ZoneAccountingMode } from "@/lib/results-calc";
import { colorTagGradient } from "@/lib/utils";
import { ColorTagPicker } from "@/components/color-tag-picker";

interface TariffInfo {
  id: string;
  name: string;
  price: string;
  order: number;
}

interface AssetInfo {
  id: string;
  name: string;
  colorTag: string;
  photoUrl: string | null;
  iconKey: string | null;
  lastReadings: { tariffId: string; reading: number }[];
}

interface ZoneDetail {
  id: string;
  name: string;
  iconKey: string | null;
  telegramEmoji: string | null;
  accountingMode: ZoneAccountingMode;
  modeLocked: boolean;
  active: boolean;
  pointId: string;
  pointName: string;
  tariffs: TariffInfo[];
  assets: AssetInfo[];
}

type ZoneKebabView = "menu" | "rename" | "mode" | "confirm-delete";
type TariffKebabView = "menu" | "edit" | "confirm-delete";
type AssetKebabView = "menu" | "edit" | "photo" | "icon" | "confirm-delete" | "initial-reading";

export default function ZoneDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n();
  const [zone, setZone] = useState<ZoneDetail | null>(null);
  const [checking, setChecking] = useState(true);

  const [zoneIconSheetOpen, setZoneIconSheetOpen] = useState(false);
  const [zoneEmojiSheetOpen, setZoneEmojiSheetOpen] = useState(false);
  const [zoneKebabOpen, setZoneKebabOpen] = useState(false);
  const [zoneKebabView, setZoneKebabView] = useState<ZoneKebabView>("menu");
  const [renameZoneValue, setRenameZoneValue] = useState("");
  const [zoneActionError, setZoneActionError] = useState<string | null>(null);

  const [createTariffOpen, setCreateTariffOpen] = useState(false);
  const [tariffName, setTariffName] = useState("");
  const [tariffPrice, setTariffPrice] = useState("");
  const [tariffError, setTariffError] = useState<string | null>(null);

  const [tariffKebab, setTariffKebab] = useState<TariffInfo | null>(null);
  const [tariffKebabView, setTariffKebabView] = useState<TariffKebabView>("menu");
  const [editTariffName, setEditTariffName] = useState("");
  const [editTariffPrice, setEditTariffPrice] = useState("");
  const [editTariffError, setEditTariffError] = useState<string | null>(null);
  const [deleteTariffError, setDeleteTariffError] = useState<string | null>(null);

  const [createAssetOpen, setCreateAssetOpen] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetColor, setAssetColor] = useState("#22c55e");
  const [assetPhotoUrl, setAssetPhotoUrl] = useState<string | null>(null);
  const [assetIconKey, setAssetIconKey] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [assetKebab, setAssetKebab] = useState<AssetInfo | null>(null);
  const [assetKebabView, setAssetKebabView] = useState<AssetKebabView>("menu");
  const [editAssetName, setEditAssetName] = useState("");
  const [editAssetColor, setEditAssetColor] = useState("#22c55e");
  const [editAssetPhotoUrl, setEditAssetPhotoUrl] = useState<string | null>(null);
  const [editAssetError, setEditAssetError] = useState<string | null>(null);
  const [editUploading, setEditUploading] = useState(false);

  // Начальные (калибровочные) показания счётчика (запрос пользователя
  // 2026-07-14: "начинаю реальный тест, нужно установить начальные значения") —
  // для актива, который заводится в приложение уже не с нуля.
  const [initialReadingTariffs, setInitialReadingTariffs] = useState<
    { id: string; name: string; reading: number | null }[]
  >([]);
  const [initialReadingValues, setInitialReadingValues] = useState<Record<string, string>>({});
  const [initialReadingHasReal, setInitialReadingHasReal] = useState(false);
  const [initialReadingError, setInitialReadingError] = useState<string | null>(null);

  async function loadZone() {
    const res = await fetch(`/api/zones/${params.id}`);
    if (res.ok) {
      setZone(await res.json());
    }
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadZone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleZoneIconChange(iconKey: string) {
    await fetch(`/api/zones/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iconKey }),
    });
    await loadZone();
  }

  async function handleZoneEmojiChange(telegramEmoji: string | null) {
    await fetch(`/api/zones/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramEmoji }),
    });
    await loadZone();
  }

  function openZoneKebab() {
    if (!zone) return;
    setZoneKebabOpen(true);
    setZoneKebabView("menu");
    setRenameZoneValue(zone.name);
    setZoneActionError(null);
  }

  async function confirmRenameZone() {
    if (!renameZoneValue.trim()) return;
    await fetch(`/api/zones/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameZoneValue }),
    });
    setZoneKebabOpen(false);
    await loadZone();
  }

  async function toggleZoneActive() {
    if (!zone) return;
    await fetch(`/api/zones/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !zone.active }),
    });
    setZoneKebabOpen(false);
    await loadZone();
  }

  async function changeAccountingMode(mode: ZoneAccountingMode) {
    setZoneActionError(null);
    const res = await fetch(`/api/zones/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountingMode: mode }),
    });
    if (!res.ok) {
      const data = await res.json();
      setZoneActionError(data.error ?? "Не удалось изменить режим учёта");
      return;
    }
    setZoneKebabOpen(false);
    await loadZone();
  }

  async function confirmDeleteZone() {
    if (!zone) return;
    const res = await fetch(`/api/zones/${zone.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setZoneActionError(data.error ?? "Не удалось удалить зону");
      return;
    }
    router.push(`/points/${zone.pointId}`);
  }

  async function handleAddTariff(event: FormEvent) {
    event.preventDefault();
    setTariffError(null);

    const res = await fetch(`/api/zones/${params.id}/tariffs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tariffName, price: tariffPrice }),
    });
    const data = await res.json();
    if (!res.ok) {
      setTariffError(data.error ?? "Не удалось добавить тариф");
      return;
    }
    setTariffName("");
    setTariffPrice("");
    setCreateTariffOpen(false);
    await loadZone();
  }

  function openTariffKebab(tariff: TariffInfo) {
    setTariffKebab(tariff);
    setTariffKebabView("menu");
    setEditTariffName(tariff.name);
    setEditTariffPrice(tariff.price);
    setEditTariffError(null);
    setDeleteTariffError(null);
  }

  async function confirmEditTariff() {
    if (!tariffKebab) return;
    setEditTariffError(null);
    const res = await fetch(`/api/tariffs/${tariffKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editTariffName, price: editTariffPrice }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEditTariffError(data.error ?? "Не удалось сохранить тариф");
      return;
    }
    setTariffKebab(null);
    await loadZone();
  }

  async function confirmDeleteTariff() {
    if (!tariffKebab) return;
    setDeleteTariffError(null);
    const res = await fetch(`/api/tariffs/${tariffKebab.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteTariffError(data.error ?? "Не удалось удалить тариф");
      return;
    }
    setTariffKebab(null);
    await loadZone();
  }

  async function handleUploadPhoto(file: File) {
    setUploading(true);
    setAssetError(null);
    try {
      const compressed = await compressImageFile(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setAssetError(data.error ?? "Не удалось загрузить фото");
        return;
      }
      setAssetPhotoUrl(data.url);
    } finally {
      setUploading(false);
    }
  }

  async function handleAddAsset(event: FormEvent) {
    event.preventDefault();
    setAssetError(null);

    const res = await fetch(`/api/zones/${params.id}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: assetName,
        colorTag: assetColor,
        photoUrl: assetPhotoUrl,
        iconKey: assetIconKey,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAssetError(data.error ?? "Не удалось добавить актив");
      return;
    }
    setAssetName("");
    setAssetPhotoUrl(null);
    setAssetIconKey(null);
    setCreateAssetOpen(false);
    await loadZone();
  }

  // Порядок активов внутри зоны — ручной, задаёт владелец (фидбек
  // 2026-07-11), влияет на список/форму сдачи итогов/отчёты/сводки везде.
  async function moveAsset(id: string, direction: "up" | "down") {
    await fetch(`/api/assets/${id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    await loadZone();
  }

  function openAssetKebab(asset: AssetInfo) {
    setAssetKebab(asset);
    setAssetKebabView("menu");
    setEditAssetName(asset.name);
    setEditAssetColor(asset.colorTag);
    setEditAssetPhotoUrl(asset.photoUrl);
    setEditAssetError(null);
  }

  async function openInitialReading() {
    if (!assetKebab) return;
    setInitialReadingError(null);
    const res = await fetch(`/api/assets/${assetKebab.id}/initial-readings`);
    const data = await res.json();
    if (!res.ok) {
      setInitialReadingError(data.error ?? t.zoneDetail.initialReadingSaveError);
      setAssetKebabView("initial-reading");
      return;
    }
    setInitialReadingTariffs(data.tariffs);
    setInitialReadingValues(
      Object.fromEntries(data.tariffs.map((tf: { id: string; reading: number | null }) => [tf.id, tf.reading?.toString() ?? ""]))
    );
    setInitialReadingHasReal(data.hasRealReadings);
    setAssetKebabView("initial-reading");
  }

  async function confirmInitialReading() {
    if (!assetKebab) return;
    setInitialReadingError(null);
    const res = await fetch(`/api/assets/${assetKebab.id}/initial-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readings: initialReadingValues }),
    });
    if (!res.ok) {
      const data = await res.json();
      setInitialReadingError(data.error ?? t.zoneDetail.initialReadingSaveError);
      return;
    }
    setAssetKebab(null);
  }

  async function handleEditUploadPhoto(file: File) {
    setEditUploading(true);
    setEditAssetError(null);
    try {
      const compressed = await compressImageFile(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setEditAssetError(data.error ?? "Не удалось загрузить фото");
        return;
      }
      setEditAssetPhotoUrl(data.url);
    } finally {
      setEditUploading(false);
    }
  }

  async function confirmEditAsset() {
    if (!assetKebab) return;
    setEditAssetError(null);
    const res = await fetch(`/api/assets/${assetKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editAssetName, colorTag: editAssetColor, photoUrl: editAssetPhotoUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEditAssetError(data.error ?? "Не удалось сохранить актив");
      return;
    }
    setAssetKebab(null);
    await loadZone();
  }

  async function confirmDeleteAsset() {
    if (!assetKebab) return;
    await fetch(`/api/assets/${assetKebab.id}`, { method: "DELETE" });
    setAssetKebab(null);
    await loadZone();
  }

  async function handleAssetIconChange(nextIconKey: string) {
    if (!assetKebab) return;
    await fetch(`/api/assets/${assetKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iconKey: nextIconKey }),
    });
    setAssetKebab(null);
    await loadZone();
  }

  if (checking) return null;
  if (!zone) {
    return (
      <OwnerShell>
        <div className="flex flex-1 items-center justify-center bg-surface-0 px-4">
          <p className="text-body-airbnb text-muted-foreground">{t.zoneDetail.notFound}</p>
        </div>
      </OwnerShell>
    );
  }

  const tariffLimitReached = zone.tariffs.length >= 2;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-6">
          <div>
            <Link href={`/points/${zone.pointId}`} className="mb-2 block w-fit text-body-airbnb font-semibold text-primary">
              ← {t.zonesList.title} · {zone.pointName}
            </Link>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <TileIcon iconKey={zone.iconKey} emoji={zone.telegramEmoji} size="lg" />
                <div>
                  <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{zone.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusChip>{t.zonesList.modeChip[zone.accountingMode]}</StatusChip>
                    {!zone.active && (
                      <StatusChip variant="neutral">{t.zonesList.zoneInactiveChip}</StatusChip>
                    )}
                  </div>
                </div>
              </div>
              <KebabButton onClick={openZoneKebab} label={t.zoneDetail.zoneActionsLabel} />
            </div>
          </div>

          {zone.accountingMode === "cash_only" && (
            <SpringCard hover={false}>
              <p className="text-body-airbnb text-muted-foreground">{t.zoneDetail.cashOnlyNote}</p>
            </SpringCard>
          )}

          {zone.accountingMode !== "cash_only" && (
          <>
          <SpringCard hover={false} className="flex flex-col gap-1">
            <h2 className="text-section-title">{t.zoneDetail.tariffsCardLabel}</h2>

            {zone.tariffs.map((tariff) => (
              <div key={tariff.id} className="flex items-center justify-between border-t border-border py-3 first:border-t-0">
                <div className="text-body-airbnb">{tariff.name}</div>
                <div className="flex items-center gap-3.5">
                  <span className="text-[0.96875rem] font-bold tabular-nums">{tariff.price}</span>
                  <KebabButton onClick={() => openTariffKebab(tariff)} label={t.zoneDetail.tariffActionsLabel} />
                </div>
              </div>
            ))}

            <PressableScale>
              <Button
                type="button"
                variant="dark"
                size="sm"
                disabled={tariffLimitReached}
                className="mt-3 w-full gap-1.5"
                onClick={() => setCreateTariffOpen(true)}
              >
                <Plus />
                {tariffLimitReached ? t.zoneDetail.tariffLimitReached : t.zoneDetail.addTariffButton}
              </Button>
            </PressableScale>
          </SpringCard>

          <SpringCard hover={false} className="flex flex-col gap-1">
            <h2 className="text-section-title">
              {t.zoneDetail.assetsTitle} · {zone.assets.length}
            </h2>

            {zone.assets.map((asset, index) => (
              <div
                key={asset.id}
                className="-mx-2 flex items-center justify-between rounded-control border-t border-border px-2 py-3 first:border-t-0"
                style={{ background: colorTagGradient(asset.colorTag) }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <div className="flex size-16 items-center justify-center rounded-control bg-muted">
                      {asset.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.photoUrl} alt="" className="size-full rounded-control object-cover" />
                      ) : (
                        <AssetOrZoneIcon iconKey={asset.iconKey} className="size-8 text-muted-foreground" />
                      )}
                    </div>
                    <span
                      className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-card"
                      style={{ backgroundColor: asset.colorTag }}
                    />
                  </div>
                  <div>
                    <div className="text-card-title">{asset.name}</div>
                    {zone.accountingMode === "counters" && asset.lastReadings.length > 0 && (
                      <p className="text-body-airbnb tabular-nums">
                        {zone.tariffs.length > 1
                          ? asset.lastReadings
                              .map((r) => {
                                const tariff = zone.tariffs.find((t) => t.id === r.tariffId);
                                return `${tariff?.name ?? ""}: ${r.reading}`;
                              })
                              .join(" · ")
                          : asset.lastReadings[0].reading}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveAsset(asset.id, "up")}
                      aria-label={t.common.moveUp}
                      className="flex size-6 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={index === zone.assets.length - 1}
                      onClick={() => moveAsset(asset.id, "down")}
                      aria-label={t.common.moveDown}
                      className="flex size-6 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </div>
                  <KebabButton onClick={() => openAssetKebab(asset)} label={t.zoneDetail.assetActionsLabel} />
                </div>
              </div>
            ))}

            <PressableScale>
              <Button
                variant="dark"
                size="sm"
                className="mt-3 w-full gap-1.5"
                onClick={() => setCreateAssetOpen(true)}
              >
                <Plus />
                {t.zoneDetail.addAssetButton}
              </Button>
            </PressableScale>
          </SpringCard>
          </>
          )}
        </div>
      </div>

      <IconPickerSheet
        open={zoneIconSheetOpen}
        onClose={() => setZoneIconSheetOpen(false)}
        value={zone.iconKey}
        onChange={handleZoneIconChange}
      />

      <EmojiPickerSheet
        open={zoneEmojiSheetOpen}
        onClose={() => setZoneEmojiSheetOpen(false)}
        value={zone.telegramEmoji}
        onChange={handleZoneEmojiChange}
      />

      <BottomSheet open={zoneKebabOpen} onClose={() => setZoneKebabOpen(false)}>
        {zoneKebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{zone.name}</h2>
            <ActionSheetItem icon={Pencil} onClick={() => setZoneKebabView("rename")}>
              {t.zoneDetail.renameZone}
            </ActionSheetItem>
            <ActionSheetItem
              icon={ImagePlus}
              onClick={() => {
                setZoneKebabOpen(false);
                setZoneIconSheetOpen(true);
              }}
            >
              {t.common.changeIcon}
            </ActionSheetItem>
            <ActionSheetItem
              icon={Smile}
              onClick={() => {
                setZoneKebabOpen(false);
                setZoneEmojiSheetOpen(true);
              }}
            >
              {t.emojiPicker.title}
            </ActionSheetItem>
            {!zone.modeLocked && (
              <ActionSheetItem icon={ListChecks} onClick={() => setZoneKebabView("mode")}>
                {t.zoneDetail.changeAccountingModeAction}
              </ActionSheetItem>
            )}
            <ActionSheetItem icon={zone.active ? Pause : Play} onClick={toggleZoneActive}>
              {zone.active ? t.zoneDetail.deactivateZone : t.zoneDetail.activateZone}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setZoneKebabView("confirm-delete")}>
              {t.zoneDetail.deleteZone}
            </ActionSheetItem>
          </div>
        )}
        {zoneKebabView === "mode" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.zoneDetail.changeAccountingModeAction}
            </h2>
            <div className="rounded-control border border-border">
              {ZONE_ACCOUNTING_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => changeAccountingMode(mode)}
                  className="flex w-full items-center justify-between border-t border-border px-3 py-2.5 text-left first:border-t-0"
                >
                  <span>
                    <span className="block text-body-airbnb">
                      {mode === "counters"
                        ? t.zonesList.accountingModeCounters
                        : mode === "launches"
                          ? t.zonesList.accountingModeLaunches
                          : t.zonesList.accountingModeCashOnly}
                    </span>
                    <span className="block text-caption-airbnb">
                      {mode === "counters"
                        ? t.zonesList.accountingModeCountersHint
                        : mode === "launches"
                          ? t.zonesList.accountingModeLaunchesHint
                          : t.zonesList.accountingModeCashOnlyHint}
                    </span>
                  </span>
                  {zone.accountingMode === mode && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
            {zoneActionError && <p className="text-sm text-destructive">{zoneActionError}</p>}
            <Button variant="outline" className="w-full" onClick={() => setZoneKebabView("menu")}>
              {t.common.cancel}
            </Button>
          </div>
        )}
        {zoneKebabView === "rename" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.renameZone}</h2>
            <Input autoFocus value={renameZoneValue} onChange={(e) => setRenameZoneValue(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setZoneKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <SaveButton className="w-full" onClick={confirmRenameZone}>
                {t.common.save}
                </SaveButton>
              </PressableScale>
            </div>
          </div>
        )}
        {zoneKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.deleteZone}</h2>
            <p className="text-body-airbnb">{t.zoneDetail.confirmDeleteZone}</p>
            {zoneActionError && <p className="text-sm text-destructive">{zoneActionError}</p>}
            <div className="flex gap-2">
              <PressableScale className="flex-1">
                <Button variant="outline" className="w-full gap-1.5" onClick={() => setZoneKebabView("menu")}>
                  <X className="size-4" />
                  {t.common.cancel}
                </Button>
              </PressableScale>
              <PressableScale className="flex-1">
                <Button variant="destructive" className="w-full gap-1.5" onClick={confirmDeleteZone}>
                  <Trash2 className="size-4" />
                  {t.common.delete}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={createTariffOpen} onClose={() => setCreateTariffOpen(false)}>
        <form onSubmit={handleAddTariff} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.newTariffTitle}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="tariffName">{t.zoneDetail.tariffNameLabel}</Label>
            <Input id="tariffName" value={tariffName} onChange={(e) => setTariffName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="tariffPrice">{t.zoneDetail.tariffPriceLabel}</Label>
            <Input
              id="tariffPrice"
              type="number"
              min="0"
              step="0.01"
              value={tariffPrice}
              onChange={(e) => setTariffPrice(e.target.value)}
              required
            />
          </div>
          {tariffError && <p className="text-sm text-destructive">{tariffError}</p>}
          <PressableScale>
            <Button type="submit" className="w-full">
              {t.zoneDetail.addTariffButton}
            </Button>
          </PressableScale>
        </form>
      </BottomSheet>

      <BottomSheet open={tariffKebab !== null} onClose={() => setTariffKebab(null)}>
        {tariffKebab && tariffKebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{tariffKebab.name}</h2>
            <ActionSheetItem icon={Pencil} onClick={() => setTariffKebabView("edit")}>
              {t.zoneDetail.editTariff}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setTariffKebabView("confirm-delete")}>
              {t.zoneDetail.deleteTariffAction}
            </ActionSheetItem>
          </div>
        )}
        {tariffKebab && tariffKebabView === "edit" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.editTariff}</h2>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editTariffName">{t.zoneDetail.tariffNameLabel}</Label>
              <Input id="editTariffName" autoFocus value={editTariffName} onChange={(e) => setEditTariffName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editTariffPrice">{t.zoneDetail.tariffPriceLabel}</Label>
              <Input
                id="editTariffPrice"
                type="number"
                min="0"
                step="0.01"
                value={editTariffPrice}
                onChange={(e) => setEditTariffPrice(e.target.value)}
              />
            </div>
            {editTariffError && <p className="text-sm text-destructive">{editTariffError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setTariffKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <SaveButton className="w-full" onClick={confirmEditTariff}>
                {t.common.save}
                </SaveButton>
              </PressableScale>
            </div>
          </div>
        )}
        {tariffKebab && tariffKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.deleteTariffAction}</h2>
            <p className="text-body-airbnb">{t.zoneDetail.confirmDeleteTariff}</p>
            {deleteTariffError && <p className="text-sm text-destructive">{deleteTariffError}</p>}
            <div className="flex gap-2">
              <PressableScale className="flex-1">
                <Button variant="outline" className="w-full gap-1.5" onClick={() => setTariffKebabView("menu")}>
                  <X className="size-4" />
                  {t.common.cancel}
                </Button>
              </PressableScale>
              <PressableScale className="flex-1">
                <Button variant="destructive" className="w-full gap-1.5" onClick={confirmDeleteTariff}>
                  <Trash2 className="size-4" />
                  {t.common.delete}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={createAssetOpen} onClose={() => setCreateAssetOpen(false)}>
        <form onSubmit={handleAddAsset} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.newAssetTitle}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assetName">{t.zoneDetail.assetNameLabel}</Label>
            <Input id="assetName" value={assetName} onChange={(e) => setAssetName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assetColor">{t.zoneDetail.assetColorLabel}</Label>
            <ColorTagPicker value={assetColor} onChange={setAssetColor} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t.zoneDetail.assetPhotoLabel}</Label>
            <div className="flex flex-wrap items-center gap-3">
              {assetPhotoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetPhotoUrl} alt="" className="size-12 rounded-control object-cover" />
              )}
              <PressableScale>
                <FilePickerButton
                  accept="image/jpeg,image/png,image/webp"
                  onFileSelected={handleUploadPhoto}
                  disabled={uploading}
                  hasFile={!!assetPhotoUrl}
                />
              </PressableScale>
              {assetPhotoUrl && (
                <PressableScale>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setAssetPhotoUrl(null)}>
                    <Trash2 />
                    {t.zoneDetail.removePhoto}
                  </Button>
                </PressableScale>
              )}
              <IconPicker value={assetIconKey} onChange={setAssetIconKey} />
            </div>
            {uploading && <p className="text-caption-airbnb">{t.zoneDetail.uploading}</p>}
          </div>
          {assetError && <p className="text-sm text-destructive">{assetError}</p>}
          <PressableScale>
            <Button type="submit" className="w-full">
              {t.zoneDetail.addAssetButton}
            </Button>
          </PressableScale>
        </form>
      </BottomSheet>

      <BottomSheet
        open={assetKebab !== null && assetKebabView !== "photo" && assetKebabView !== "icon"}
        onClose={() => setAssetKebab(null)}
      >
        {assetKebab && assetKebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{assetKebab.name}</h2>
            <ActionSheetItem icon={Pencil} onClick={() => setAssetKebabView("edit")}>
              {t.zoneDetail.nameAndColorAction}
            </ActionSheetItem>
            {zone.accountingMode === "counters" && (
              <ActionSheetItem icon={Gauge} onClick={openInitialReading}>
                {t.zoneDetail.initialReadingAction}
              </ActionSheetItem>
            )}
            <ActionSheetItem icon={Camera} onClick={() => setAssetKebabView("photo")}>
              {t.zoneDetail.replacePhoto}
            </ActionSheetItem>
            <ActionSheetItem icon={ImagePlus} onClick={() => setAssetKebabView("icon")}>
              {t.common.changeIcon}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setAssetKebabView("confirm-delete")}>
              {t.zoneDetail.deleteAssetAction}
            </ActionSheetItem>
          </div>
        )}
        {assetKebab && assetKebabView === "edit" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.nameAndColorAction}</h2>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editAssetName">{t.zoneDetail.assetNameLabel}</Label>
              <Input id="editAssetName" autoFocus value={editAssetName} onChange={(e) => setEditAssetName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editAssetColor">{t.zoneDetail.assetColorLabel}</Label>
              <ColorTagPicker value={editAssetColor} onChange={setEditAssetColor} />
            </div>
            {editAssetError && <p className="text-sm text-destructive">{editAssetError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAssetKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <SaveButton className="w-full" onClick={confirmEditAsset}>
                {t.common.save}
                </SaveButton>
              </PressableScale>
            </div>
          </div>
        )}
        {assetKebab && assetKebabView === "initial-reading" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.initialReadingAction}</h2>
            <p className="text-body-airbnb text-muted-foreground">{t.zoneDetail.initialReadingHint}</p>
            {initialReadingHasReal && (
              <p className="text-caption-airbnb text-warning">{t.zoneDetail.initialReadingWarning}</p>
            )}
            {initialReadingTariffs.map((tariff) => (
              <div key={tariff.id} className="flex flex-col gap-1">
                <Label htmlFor={`initialReading-${tariff.id}`}>{tariff.name}</Label>
                <Input
                  id={`initialReading-${tariff.id}`}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="0–9999"
                  className="h-14 text-lg tabular-nums"
                  value={initialReadingValues[tariff.id] ?? ""}
                  onChange={(e) =>
                    setInitialReadingValues((prev) => ({ ...prev, [tariff.id]: e.target.value }))
                  }
                />
              </div>
            ))}
            {initialReadingError && <p className="text-sm text-destructive">{initialReadingError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAssetKebabView("menu")}>
                {t.common.cancel}
              </Button>
              <PressableScale className="flex-1">
                <SaveButton className="w-full" onClick={confirmInitialReading}>
                  {t.common.save}
                </SaveButton>
              </PressableScale>
            </div>
          </div>
        )}
        {assetKebab && assetKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.deleteAssetAction}</h2>
            <p className="text-body-airbnb">{t.zoneDetail.confirmDeleteAsset}</p>
            <div className="flex gap-2">
              <PressableScale className="flex-1">
                <Button variant="outline" className="w-full gap-1.5" onClick={() => setAssetKebabView("menu")}>
                  <X className="size-4" />
                  {t.common.cancel}
                </Button>
              </PressableScale>
              <PressableScale className="flex-1">
                <Button variant="destructive" className="w-full gap-1.5" onClick={confirmDeleteAsset}>
                  <Trash2 className="size-4" />
                  {t.common.delete}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>
      {assetKebab && (
        <BottomSheet open={assetKebabView === "photo"} onClose={() => setAssetKebabView("menu")}>
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.replacePhoto}</h2>
            <div className="flex items-center gap-3">
              {editAssetPhotoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={editAssetPhotoUrl} alt="" className="size-12 rounded-control object-cover" />
              )}
              <PressableScale>
                <FilePickerButton
                  accept="image/jpeg,image/png,image/webp"
                  onFileSelected={handleEditUploadPhoto}
                  disabled={editUploading}
                  hasFile={!!editAssetPhotoUrl}
                />
              </PressableScale>
              {editAssetPhotoUrl && (
                <PressableScale>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setEditAssetPhotoUrl(null)}>
                    <Trash2 />
                    {t.zoneDetail.removePhoto}
                  </Button>
                </PressableScale>
              )}
            </div>
            {editUploading && <p className="text-caption-airbnb">{t.zoneDetail.uploading}</p>}
            {editAssetError && <p className="text-sm text-destructive">{editAssetError}</p>}
            <PressableScale>
              <SaveButton className="w-full" onClick={confirmEditAsset}>
              {t.common.save}
              </SaveButton>
            </PressableScale>
          </div>
        </BottomSheet>
      )}
      {assetKebab && (
        <IconPickerSheet
          open={assetKebabView === "icon"}
          onClose={() => setAssetKebabView("menu")}
          value={assetKebab.iconKey}
          onChange={handleAssetIconChange}
        />
      )}
    </OwnerShell>
  );
}
