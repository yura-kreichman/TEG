"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Pencil, Camera, ImagePlus, ListChecks, Trash2, Plus, Pause, Play, ChevronDown, ChevronUp, Smile, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
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
import { ZONE_ACCOUNTING_MODES, isGameRoomZone, type LaunchMode, type ZoneAccountingMode } from "@/lib/results-calc";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { formatTime } from "@/lib/datetime-format";
import { Money } from "@/components/money";
import { cn, colorTagGradient } from "@/lib/utils";
import { ColorTagPicker } from "@/components/color-tag-picker";
import { useSavePulse } from "@/hooks/use-save-pulse";

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
  active: boolean;
  lastReadings: { tariffId: string; reading: number }[];
}

interface ZoneDetail {
  id: string;
  name: string;
  iconKey: string | null;
  telegramEmoji: string | null;
  accountingMode: ZoneAccountingMode;
  launchMode: LaunchMode;
  longLaunchThresholdMinutes: number;
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
  const { saved: renameZoneSaved, pulse: renameZonePulse } = useSavePulse();
  const [zoneActionError, setZoneActionError] = useState<string | null>(null);
  const { saved: zoneDeleted, pulse: zoneDeletePulse } = useSavePulse();

  // Тариф "Игровой комнаты" (docs/spec/04-game-room.md) — история
  // (LaunchPricing), форма всегда показывает/добавляет только "действующий
  // сейчас" тариф, старые записи не редактируются.
  const [pricingMode, setPricingMode] = useState<"fixed" | "per_minute">("fixed");
  const [priceValue, setPriceValue] = useState("");
  const [durationValue, setDurationValue] = useState("");
  const [roundingValue, setRoundingValue] = useState<"up" | "down" | "nearest">("nearest");
  const [minAmountValue, setMinAmountValue] = useState("");
  const [pricingError, setPricingError] = useState<string | null>(null);
  const { saved: pricingSaved, pulse: pricingPulse } = useSavePulse();
  const [pricingHistory, setPricingHistory] = useState<
    {
      id: string;
      pricingMode: "fixed" | "per_minute";
      price: number;
      durationMinutes: number | null;
      roundingMode: "up" | "down" | "nearest" | null;
      minAmount: number | null;
      effectiveFrom: string;
    }[]
  >([]);
  const [thresholdValue, setThresholdValue] = useState("60");
  const { saved: thresholdSaved, pulse: thresholdPulse } = useSavePulse();

  const [createTariffOpen, setCreateTariffOpen] = useState(false);
  const [tariffName, setTariffName] = useState("");
  const { saved: addTariffSaved, pulse: addTariffPulse } = useSavePulse();
  const [tariffPrice, setTariffPrice] = useState("");
  const [tariffError, setTariffError] = useState<string | null>(null);

  const [tariffKebab, setTariffKebab] = useState<TariffInfo | null>(null);
  const [tariffKebabView, setTariffKebabView] = useState<TariffKebabView>("menu");
  const [editTariffName, setEditTariffName] = useState("");
  const [editTariffPrice, setEditTariffPrice] = useState("");
  const { saved: editTariffSaved, pulse: editTariffPulse } = useSavePulse();
  const [editTariffError, setEditTariffError] = useState<string | null>(null);
  const [deleteTariffError, setDeleteTariffError] = useState<string | null>(null);
  const { saved: tariffDeleted, pulse: tariffDeletePulse } = useSavePulse();

  const [createAssetOpen, setCreateAssetOpen] = useState(false);
  const [assetName, setAssetName] = useState("");
  const { saved: addAssetSaved, pulse: addAssetPulse } = useSavePulse();
  const [assetColor, setAssetColor] = useState("#22c55e");
  const [assetPhotoUrl, setAssetPhotoUrl] = useState<string | null>(null);
  const [assetIconKey, setAssetIconKey] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [assetKebab, setAssetKebab] = useState<AssetInfo | null>(null);
  const [assetKebabView, setAssetKebabView] = useState<AssetKebabView>("menu");
  const [editAssetName, setEditAssetName] = useState("");
  const [editAssetColor, setEditAssetColor] = useState("#22c55e");
  const { saved: editAssetSaved, pulse: editAssetPulse } = useSavePulse();
  const [editAssetPhotoUrl, setEditAssetPhotoUrl] = useState<string | null>(null);
  const [editAssetError, setEditAssetError] = useState<string | null>(null);
  const { saved: assetDeleted, pulse: assetDeletePulse } = useSavePulse();
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
  const { saved: initialReadingSaved, pulse: initialReadingPulse } = useSavePulse();

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

  function loadPricing(zoneId: string) {
    fetch(`/api/zones/${zoneId}/launch-pricing`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.pricing) {
          setPricingMode(data.pricing.pricingMode);
          setPriceValue(String(data.pricing.price));
          setDurationValue(data.pricing.durationMinutes != null ? String(data.pricing.durationMinutes) : "");
          setRoundingValue(data.pricing.roundingMode ?? "nearest");
          setMinAmountValue(data.pricing.minAmount != null ? String(data.pricing.minAmount) : "");
        }
        setPricingHistory(data?.history ?? []);
      });
  }

  useEffect(() => {
    if (!zone) return;
    setThresholdValue(String(zone.longLaunchThresholdMinutes));
    if (!isGameRoomZone(zone)) return;
    loadPricing(zone.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone?.id, zone?.launchMode, zone?.accountingMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function savePricing() {
    if (!zone) return;
    setPricingError(null);
    const res = await fetch(`/api/zones/${zone.id}/launch-pricing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pricingMode,
        price: priceValue,
        durationMinutes: pricingMode === "fixed" ? durationValue || null : null,
        roundingMode: pricingMode === "per_minute" ? roundingValue : null,
        minAmount: pricingMode === "per_minute" ? minAmountValue || null : null,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setPricingError(data.error ?? t.zoneDetail.gameRoomSaveError);
      return;
    }
    loadPricing(zone.id);
    pricingPulse(() => {});
  }

  function formatPricingDate(iso: string) {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${t.readings.monthsGenitive[d.getUTCMonth()]} · ${formatTime(iso)}`;
  }

  function formatPricingModeLabel(p: (typeof pricingHistory)[number]) {
    if (p.pricingMode === "fixed") {
      return p.durationMinutes
        ? `${t.zoneDetail.gameRoomPricingModeFixed} · ${p.durationMinutes} ${t.operatorApp.workTime.minutesShort}`
        : t.zoneDetail.gameRoomPricingModeFixed;
    }
    const roundingLabel =
      p.roundingMode === "up"
        ? t.zoneDetail.gameRoomRoundingUp
        : p.roundingMode === "down"
          ? t.zoneDetail.gameRoomRoundingDown
          : t.zoneDetail.gameRoomRoundingNearest;
    return `${t.zoneDetail.gameRoomPricingModePerMinute} · ${roundingLabel}`;
  }

  async function saveThreshold() {
    if (!zone) return;
    setPricingError(null);
    const res = await fetch(`/api/zones/${zone.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ longLaunchThresholdMinutes: thresholdValue }),
    });
    if (!res.ok) {
      const data = await res.json();
      setPricingError(data.error ?? t.zoneDetail.gameRoomSaveError);
      return;
    }
    thresholdPulse(() => {});
  }

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
    await loadZone();
    renameZonePulse(() => setZoneKebabOpen(false));
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

  async function changeAccountingMode(mode: ZoneAccountingMode, nextLaunchMode: LaunchMode = "manual") {
    setZoneActionError(null);
    const res = await fetch(`/api/zones/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountingMode: mode, launchMode: nextLaunchMode }),
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
    zoneDeletePulse(() => router.push(`/points/${zone.pointId}`));
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
    await loadZone();
    addTariffPulse(() => {
      setTariffName("");
      setTariffPrice("");
      setCreateTariffOpen(false);
    });
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
    await loadZone();
    editTariffPulse(() => setTariffKebab(null));
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
    await loadZone();
    tariffDeletePulse(() => setTariffKebab(null));
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
    await loadZone();
    addAssetPulse(() => {
      setAssetName("");
      setAssetPhotoUrl(null);
      setAssetIconKey(null);
      setCreateAssetOpen(false);
    });
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
    initialReadingPulse(() => setAssetKebab(null));
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
    await loadZone();
    editAssetPulse(() => setAssetKebab(null));
  }

  async function confirmDeleteAsset() {
    if (!assetKebab) return;
    await fetch(`/api/assets/${assetKebab.id}`, { method: "DELETE" });
    await loadZone();
    assetDeletePulse(() => setAssetKebab(null));
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

  // Временная деактивация актива (запрос пользователя 2026-07-16: конкретный
  // актив на ремонте) — в отличие от зоны/точки, актив не скрывается у
  // оператора, а становится read-only (см. operator/submit/page.tsx).
  async function toggleAssetActive() {
    if (!assetKebab) return;
    await fetch(`/api/assets/${assetKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !assetKebab.active }),
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
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-6">
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
                    <StatusChip>
                      {isGameRoomZone(zone) ? t.zonesList.modeChip.game_room : t.zonesList.modeChip[zone.accountingMode]}
                    </StatusChip>
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

          {/* Тариф "Игровой комнаты" (LaunchPricing, не Tariff) — история,
              форма всегда правит "действующий сейчас" (docs/spec/04-game-room.md,
              "Кабинет владельца"). Список пусков и "Сейчас на точке" — на
              отдельных экранах, ссылки ниже. */}
          {isGameRoomZone(zone) && (
            <>
            <SpringCard hover={false} className="flex flex-col gap-3">
              <span className="text-section-title">{t.zoneDetail.gameRoomPricingCardLabel}</span>
              <SegmentedTabs
                shape="control"
                options={[
                  { key: "fixed" as const, label: t.zoneDetail.gameRoomPricingModeFixed },
                  { key: "per_minute" as const, label: t.zoneDetail.gameRoomPricingModePerMinute },
                ]}
                value={pricingMode}
                onChange={setPricingMode}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="gameRoomPrice">
                  {pricingMode === "fixed" ? t.zoneDetail.gameRoomPriceLabel : t.zoneDetail.gameRoomRateLabel}
                </Label>
                <MoneyInput
                  id="gameRoomPrice"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                />
              </div>
              {pricingMode === "fixed" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="gameRoomDuration">
                    {t.zoneDetail.gameRoomDurationLabel} <span className="font-normal text-muted-foreground">({t.common.optional})</span>
                  </Label>
                  <Input
                    id="gameRoomDuration"
                    type="number"
                    inputMode="numeric"
                    placeholder={t.zoneDetail.gameRoomDurationPlaceholder}
                    value={durationValue}
                    onChange={(e) => setDurationValue(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <Label>{t.zoneDetail.gameRoomRoundingLabel}</Label>
                    <SegmentedTabs
                      shape="control"
                      options={[
                        { key: "up" as const, label: t.zoneDetail.gameRoomRoundingUp },
                        { key: "nearest" as const, label: t.zoneDetail.gameRoomRoundingNearest },
                        { key: "down" as const, label: t.zoneDetail.gameRoomRoundingDown },
                      ]}
                      value={roundingValue}
                      onChange={setRoundingValue}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="gameRoomMinAmount">
                      {t.zoneDetail.gameRoomMinAmountLabel} <span className="font-normal text-muted-foreground">({t.common.optional})</span>
                    </Label>
                    <MoneyInput
                      id="gameRoomMinAmount"
                      value={minAmountValue}
                      onChange={(e) => setMinAmountValue(e.target.value)}
                    />
                  </div>
                </>
              )}
              {pricingError && <p className="text-sm text-destructive">{pricingError}</p>}
              <PressableScale>
                <SaveButton className="h-11" onClick={savePricing} saved={pricingSaved} />
              </PressableScale>

              {pricingHistory.length > 0 && (
                <div className="mt-1 flex flex-col gap-1 border-t border-border pt-3">
                  <span className="text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                    {t.zoneDetail.gameRoomPricingHistoryLabel}
                  </span>
                  {pricingHistory.map((p, i) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 border-t border-border py-2 text-caption-airbnb first:border-t-0"
                    >
                      <span className="min-w-0 truncate text-muted-foreground">
                        {formatPricingDate(p.effectiveFrom)}
                        {i === 0 && (
                          <span className="ml-1.5">
                            <StatusChip>{t.zoneDetail.gameRoomPricingActiveChip}</StatusChip>
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatPricingModeLabel(p)} · <Money value={p.price} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SpringCard>

            <SpringCard hover={false} className="flex flex-col gap-2">
              <span className="text-section-title">{t.zoneDetail.gameRoomThresholdLabel}</span>
              <p className="text-caption-airbnb text-muted-foreground">{t.zoneDetail.gameRoomThresholdHint}</p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  className="h-11 max-w-32"
                  value={thresholdValue}
                  onChange={(e) => setThresholdValue(e.target.value)}
                />
                <PressableScale>
                  <SaveButton className="h-11" onClick={saveThreshold} saved={thresholdSaved} />
                </PressableScale>
              </div>
            </SpringCard>

            <div className="grid grid-cols-2 gap-3">
              <PressableScale>
                <Link
                  href={`/money/game-room?pointId=${zone.pointId}`}
                  className="flex h-full flex-col justify-center rounded-card border border-border bg-card p-3.5 text-center text-body-airbnb font-semibold"
                >
                  {t.zoneDetail.gameRoomLiveLink}
                </Link>
              </PressableScale>
              <PressableScale>
                <Link
                  href={`/money/launches?zoneId=${zone.id}`}
                  className="flex h-full flex-col justify-center rounded-card border border-border bg-card p-3.5 text-center text-body-airbnb font-semibold"
                >
                  {t.zoneDetail.gameRoomLaunchesListLink}
                </Link>
              </PressableScale>
            </div>
            </>
          )}

          {zone.accountingMode !== "cash_only" && !isGameRoomZone(zone) && (
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
                className={cn(
                  "-mx-2 flex items-center justify-between rounded-control border-t border-border px-2 py-3 first:border-t-0",
                  (!zone.active || !asset.active) && "grayscale"
                )}
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
                    <div className="flex items-center gap-1.5">
                      <div className="text-card-title">{asset.name}</div>
                      {(!zone.active || !asset.active) && (
                        <StatusChip variant="neutral">{t.zoneDetail.assetInactiveChip}</StatusChip>
                      )}
                    </div>
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
                  onClick={() =>
                    changeAccountingMode(
                      mode,
                      mode === "launches" && zone.accountingMode === "launches" ? zone.launchMode : "manual"
                    )
                  }
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
            {/* Игровая комната — суб-режим "Пусков" (docs/spec/04-game-room.md,
                решение пользователя 2026-07-16), переключается отдельно, тем же
                тап-и-применилось паттерном, что и список выше. */}
            {zone.accountingMode === "launches" && (
              <div>
                <SegmentedTabs
                  shape="control"
                  options={[
                    { key: "manual" as const, label: t.zonesList.launchVariantManual },
                    { key: "game_room" as const, label: t.zonesList.accountingModeGameRoom },
                  ]}
                  value={zone.launchMode}
                  onChange={(v) => changeAccountingMode("launches", v)}
                />
              </div>
            )}
            {zoneActionError && <p className="text-sm text-destructive">{zoneActionError}</p>}
          </div>
        )}
        {zoneKebabView === "rename" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.renameZone}</h2>
            <Input autoFocus value={renameZoneValue} onChange={(e) => setRenameZoneValue(e.target.value)} />
            <PressableScale>
              <SaveButton className="h-12 w-full" onClick={confirmRenameZone} saved={renameZoneSaved} />
            </PressableScale>
          </div>
        )}
        {zoneKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.deleteZone}</h2>
            <p className="text-body-airbnb">{t.zoneDetail.confirmDeleteZone}</p>
            {zoneActionError && <p className="text-sm text-destructive">{zoneActionError}</p>}
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={confirmDeleteZone} deleted={zoneDeleted} />
            </PressableScale>
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
            <MoneyInput
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
            <SaveButton type="submit" className="h-12 w-full" saved={addTariffSaved} />
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
              <div className="flex items-center gap-2">
                <MoneyInput
                  id="editTariffPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-12 flex-1"
                  value={editTariffPrice}
                  onChange={(e) => setEditTariffPrice(e.target.value)}
                />
                <PressableScale>
                  <SaveButton className="h-12" onClick={confirmEditTariff} saved={editTariffSaved} />
                </PressableScale>
              </div>
            </div>
            {editTariffError && <p className="text-sm text-destructive">{editTariffError}</p>}
          </div>
        )}
        {tariffKebab && tariffKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.deleteTariffAction}</h2>
            <p className="text-body-airbnb">{t.zoneDetail.confirmDeleteTariff}</p>
            {deleteTariffError && <p className="text-sm text-destructive">{deleteTariffError}</p>}
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={confirmDeleteTariff} deleted={tariffDeleted} />
            </PressableScale>
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
            <SaveButton type="submit" className="h-12 w-full" saved={addAssetSaved} />
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
            <ActionSheetItem icon={assetKebab.active ? Pause : Play} onClick={toggleAssetActive}>
              {assetKebab.active ? t.zoneDetail.deactivateAsset : t.zoneDetail.activateAsset}
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
            <PressableScale>
              <SaveButton className="h-12 w-full" onClick={confirmEditAsset} saved={editAssetSaved} />
            </PressableScale>
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
            <PressableScale>
              <SaveButton className="h-12 w-full" onClick={confirmInitialReading} saved={initialReadingSaved} />
            </PressableScale>
          </div>
        )}
        {assetKebab && assetKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.deleteAssetAction}</h2>
            <p className="text-body-airbnb">{t.zoneDetail.confirmDeleteAsset}</p>
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={confirmDeleteAsset} deleted={assetDeleted} />
            </PressableScale>
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
              <SaveButton className="h-12 w-full" onClick={confirmEditAsset} saved={editAssetSaved} />
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
