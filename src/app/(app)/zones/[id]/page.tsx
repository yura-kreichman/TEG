"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Banknote, Check, Pencil, Camera, CircuitBoard, ClockPlus, ImagePlus, ListChecks, Timer, Trash2, Plus, Pause, Play, ChevronDown, ChevronUp, Smile, Gauge, TriangleAlert, type LucideIcon } from "lucide-react";
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
import { KebabButton, ActionSheetItem, IconActionButton } from "@/components/kebab-menu";
import { StatusChip } from "@/components/status-chip";
import { TileIcon } from "@/components/tile-icon";
import { FilePickerButton } from "@/components/file-picker-button";
import { useI18n, useCurrency, useLocale } from "@/components/i18n-provider";
import { compressImageFile } from "@/lib/client-image";
import { ZONE_ACCOUNTING_MODES, isStaysZone, type ZoneAccountingMode } from "@/lib/results-calc";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/format";
import { getCurrencySign } from "@/lib/currency";
import { cn, colorTagGradient } from "@/lib/utils";
import { ColorTagPicker } from "@/components/color-tag-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useSavePulse } from "@/hooks/use-save-pulse";
import type { Dictionary } from "@/lib/i18n";

// "stays" (Прибывания) — самостоятельный 4-й режим учёта, рядоположный
// остальным (решение пользователя 2026-07-17; было суб-режимом "launches" до
// этого) — единый список из четырёх, без второго уровня выбора.
const ACCOUNTING_MODE_LABEL: Record<ZoneAccountingMode, (t: Dictionary) => string> = {
  counters: (t) => t.zonesList.accountingModeCounters,
  launches: (t) => t.zonesList.accountingModeLaunches,
  cash_only: (t) => t.zonesList.accountingModeCashOnly,
  stays: (t) => t.zonesList.accountingModeStays,
};
const ACCOUNTING_MODE_HINT: Record<ZoneAccountingMode, (t: Dictionary) => string> = {
  counters: (t) => t.zonesList.accountingModeCountersHint,
  launches: (t) => t.zonesList.accountingModeLaunchesHint,
  cash_only: (t) => t.zonesList.accountingModeCashOnlyHint,
  stays: (t) => t.zonesList.accountingModeStaysHint,
};
// Иконки режимов учёта (запрос пользователя 2026-07-18) — "Прибывания" тот
// же Timer, что и одноимённый пункт нижнего бара Сотрудника (единообразие).
const ACCOUNTING_MODE_ICON: Record<ZoneAccountingMode, LucideIcon> = {
  counters: CircuitBoard,
  launches: ClockPlus,
  cash_only: Banknote,
  stays: Timer,
};

interface TariffOptionInfo {
  id: string;
  durationMinutes: number;
  price: string;
}

// Черновик редактируемого варианта "За вход" в форме (строковые поля инпутов,
// не число) — до сохранения не привязан к id TariffOption.
interface OptionDraft {
  durationMinutes: string;
  price: string;
}
const EMPTY_OPTION: OptionDraft = { durationMinutes: "", price: "" };

// Список вариантов "За вход" (длительность+цена) в форме тарифа — можно
// добавлять/удалять/редактировать (запрос пользователя 2026-07-17: "1 час,
// 2 часа..." — оператор выбирает вариант при старте пуска). Общий для формы
// создания и кебаба редактирования тарифа.
function TariffOptionsEditor({
  options,
  onChange,
}: {
  options: OptionDraft[];
  onChange: (next: OptionDraft[]) => void;
}) {
  const t = useI18n();

  function update(index: number, patch: Partial<OptionDraft>) {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{t.zoneDetail.gameRoomOptionsLabel}</Label>
      {options.map((opt, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min="1"
            required
            placeholder={t.zoneDetail.gameRoomOptionDurationPlaceholder}
            value={opt.durationMinutes}
            onChange={(e) => update(index, { durationMinutes: e.target.value })}
            className="flex-1"
          />
          <MoneyInput
            required
            placeholder={t.zoneDetail.gameRoomOptionPricePlaceholder}
            value={opt.price}
            onChange={(e) => update(index, { price: e.target.value })}
            className="flex-1"
          />
          {options.length > 1 && (
            <PressableScale>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t.zoneDetail.gameRoomRemoveOptionLabel}
                onClick={() => onChange(options.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </PressableScale>
          )}
        </div>
      ))}
      <PressableScale className="w-fit">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onChange([...options, EMPTY_OPTION])}
        >
          <Plus className="size-4" />
          {t.zoneDetail.gameRoomAddOptionButton}
        </Button>
      </PressableScale>
    </div>
  );
}

interface TariffInfo {
  id: string;
  name: string;
  price: string;
  order: number;
  // Только у зон "Прибывания" (запрос пользователя 2026-07-17: тарифы —
  // обычная сущность Tariff, лимит и правила те же, что у Счётчиков/Пусков).
  pricingMode: "fixed" | "per_minute" | null;
  // Только "fixed"/"За вход" — несколько вариантов длительность+цена (запрос
  // пользователя 2026-07-17: "1 час, 2 часа..." — оператор выбирает при
  // старте пуска), вместо одной пары.
  options: TariffOptionInfo[];
}

interface AssetInfo {
  id: string;
  name: string;
  colorTag: string;
  photoUrl: string | null;
  iconKey: string | null;
  active: boolean;
  lastReadings: { tariffId: string; reading: number }[];
  // Тариф зоны, который использует этот актив (только "Прибывания") — null,
  // если ещё не выбран (запрос пользователя 2026-07-17: тарифы и активы
  // создаются независимо, привязка — отдельное действие владельца).
  tariffId: string | null;
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
type TariffKebabView = "edit" | "confirm-delete";
type AssetKebabView = "menu" | "edit" | "photo" | "icon" | "confirm-delete" | "initial-reading";

export default function ZoneDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n();
  const locale = useLocale();
  const currencySign = getCurrencySign(useCurrency());
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

  const [createTariffOpen, setCreateTariffOpen] = useState(false);
  const [tariffName, setTariffName] = useState("");
  const { saved: addTariffSaved, pulse: addTariffPulse } = useSavePulse();
  const [tariffPrice, setTariffPrice] = useState("");
  const [tariffError, setTariffError] = useState<string | null>(null);
  // Поля "За вход"/"По факту" — только когда зона в режиме "Прибывания"
  // (запрос пользователя 2026-07-17: тарифы создаются как обычно, теми же
  // формами/лимитом, что у Счётчиков/Пусков, просто с доп. полями). "За
  // вход" — список вариантов длительность+цена, не одна пара (запрос
  // пользователя того же дня: "1 час, 2 часа..." — оператор выбирает при
  // старте пуска, можно добавлять/удалять/редактировать варианты).
  const [tariffPricingMode, setTariffPricingMode] = useState<"fixed" | "per_minute">("fixed");
  const [tariffOptions, setTariffOptions] = useState<OptionDraft[]>([EMPTY_OPTION]);

  const [tariffKebab, setTariffKebab] = useState<TariffInfo | null>(null);
  const [tariffKebabView, setTariffKebabView] = useState<TariffKebabView>("edit");
  const [editTariffName, setEditTariffName] = useState("");
  const [editTariffPrice, setEditTariffPrice] = useState("");
  const { saved: editTariffSaved, pulse: editTariffPulse } = useSavePulse();
  const [editTariffError, setEditTariffError] = useState<string | null>(null);
  const [deleteTariffError, setDeleteTariffError] = useState<string | null>(null);
  const { saved: tariffDeleted, pulse: tariffDeletePulse } = useSavePulse();
  const [editTariffPricingMode, setEditTariffPricingMode] = useState<"fixed" | "per_minute">("fixed");
  const [editTariffOptions, setEditTariffOptions] = useState<OptionDraft[]>([EMPTY_OPTION]);

  const [createAssetOpen, setCreateAssetOpen] = useState(false);
  const [assetName, setAssetName] = useState("");
  const { saved: addAssetSaved, pulse: addAssetPulse } = useSavePulse();
  const [assetColor, setAssetColor] = useState("#22c55e");
  const [assetPhotoUrl, setAssetPhotoUrl] = useState<string | null>(null);
  const [assetIconKey, setAssetIconKey] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Тариф выбирается независимо от создания актива (запрос пользователя
  // 2026-07-17: "можно создавать и то и то независимо... если тарифы ещё не
  // созданы — ничего страшного, потом создаст и привяжет") — необязательное
  // поле, только для зон "Прибывания".
  const [assetTariffId, setAssetTariffId] = useState("");

  const [assetKebab, setAssetKebab] = useState<AssetInfo | null>(null);
  const [assetKebabView, setAssetKebabView] = useState<AssetKebabView>("menu");
  const [editAssetName, setEditAssetName] = useState("");
  const [editAssetColor, setEditAssetColor] = useState("#22c55e");
  const { saved: editAssetSaved, pulse: editAssetPulse } = useSavePulse();
  const [editAssetPhotoUrl, setEditAssetPhotoUrl] = useState<string | null>(null);
  const [editAssetError, setEditAssetError] = useState<string | null>(null);
  const { saved: assetDeleted, pulse: assetDeletePulse } = useSavePulse();
  const [editUploading, setEditUploading] = useState(false);
  const [editAssetTariffId, setEditAssetTariffId] = useState("");

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
    zoneDeletePulse(() => router.push(`/points/${zone.pointId}`));
  }

  async function handleAddTariff(event: FormEvent) {
    event.preventDefault();
    setTariffError(null);

    const res = await fetch(`/api/zones/${params.id}/tariffs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tariffName,
        price: tariffPrice,
        ...(zone && isStaysZone(zone)
          ? {
              pricingMode: tariffPricingMode,
              options: tariffPricingMode === "fixed" ? tariffOptions : undefined,
            }
          : {}),
      }),
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
      setTariffPricingMode("fixed");
      setTariffOptions([EMPTY_OPTION]);
      setCreateTariffOpen(false);
    });
  }

  function openEditTariff(tariff: TariffInfo) {
    setTariffKebab(tariff);
    setTariffKebabView("edit");
    setEditTariffName(tariff.name);
    setEditTariffPrice(tariff.price);
    setEditTariffError(null);
    setEditTariffPricingMode(tariff.pricingMode ?? "fixed");
    setEditTariffOptions(
      tariff.options.length > 0
        ? tariff.options.map((o) => ({ durationMinutes: String(o.durationMinutes), price: o.price }))
        : [EMPTY_OPTION]
    );
  }

  function openDeleteTariffConfirm(tariff: TariffInfo) {
    setTariffKebab(tariff);
    setTariffKebabView("confirm-delete");
    setDeleteTariffError(null);
  }

  async function confirmEditTariff() {
    if (!tariffKebab) return;
    setEditTariffError(null);
    const res = await fetch(`/api/tariffs/${tariffKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editTariffName,
        price: editTariffPrice,
        ...(zone && isStaysZone(zone)
          ? {
              pricingMode: editTariffPricingMode,
              options: editTariffPricingMode === "fixed" ? editTariffOptions : undefined,
            }
          : {}),
      }),
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
        tariffId: assetTariffId || null,
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
      setAssetTariffId("");
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
    setEditAssetTariffId(asset.tariffId && zone?.tariffs.some((tf) => tf.id === asset.tariffId) ? asset.tariffId : "");
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
    if (!assetKebab || !zone) return;
    setEditAssetError(null);
    const res = await fetch(`/api/assets/${assetKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editAssetName,
        colorTag: editAssetColor,
        photoUrl: editAssetPhotoUrl,
        ...(isStaysZone(zone) ? { tariffId: editAssetTariffId || null } : {}),
      }),
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

  // Тариф актива невалиден, если не выбран вообще, или выбранный тариф с тех
  // пор удалён (soft-delete — Asset.tariffId физически остаётся, но тариф
  // пропадает из zone.tariffs, запрос пользователя 2026-07-17: "удалил
  // тариф, а он уже был привязан к активу... должно быть: статус тарифа не
  // выбран"). В обоих случаях актив не может начать пуск. Локальная const
  // (не прямая ссылка на zone внутри функции) — иначе TS теряет narrowing
  // "zone не null" внутри вложенной function-декларации.
  const activeZoneTariffs = zone.tariffs;
  const activeZoneTariffIds = new Set(activeZoneTariffs.map((tf) => tf.id));
  function assetHasValidTariff(asset: AssetInfo): boolean {
    return !!asset.tariffId && activeZoneTariffIds.has(asset.tariffId);
  }
  function assetTariffName(asset: AssetInfo): string | null {
    return activeZoneTariffs.find((tf) => tf.id === asset.tariffId)?.name ?? null;
  }

  // Компактная подпись тарифа "Прибывания" под названием — "За вход" со
  // списком вариантов ("60 мин — 100, 120 мин — 180") или "По факту"
  // (минималка отдельно не показываем здесь, только в форме редактирования).
  function formatTariffPricingLabel(tariff: TariffInfo): string {
    if (tariff.pricingMode === "fixed") {
      if (tariff.options.length === 0) return t.zoneDetail.gameRoomPricingModeFixed;
      const list = tariff.options
        .map(
          (o) =>
            `${o.durationMinutes} ${t.operatorApp.workTime.minutesShort} — ${formatMoney(Number(o.price), locale)}${currencySign ?? ""}`
        )
        .join(", ");
      return `${t.zoneDetail.gameRoomPricingModeFixed} · ${list}`;
    }
    return t.zoneDetail.gameRoomPricingModePerMinute;
  }

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

          {/* Тарифы (Tariff) — те же правила и лимит (до 2 на зону), что у
              Счётчиков/Пусков (запрос пользователя 2026-07-17: "здесь
              действуют те правила и лимит тарифов"). У "Прибываний" —
              доп. поля За вход/По факту в форме ниже; активы ссылаются на
              один из этих тарифов через свой кебаб, привязка отдельная
              (docs/spec/04-game-room.md). Владелец не следит за отдельными
              пусками — ни порога долгого пуска, ни "Сейчас на точке"/
              "Список пусков" нет (запрос пользователя 2026-07-17). */}
          {zone.accountingMode !== "cash_only" && (
          <SpringCard hover={false} className="flex flex-col gap-1">
            <h2 className="text-section-title">{t.zoneDetail.tariffsCardLabel}</h2>

            {zone.tariffs.map((tariff) => (
              <div key={tariff.id} className="flex items-center justify-between border-t border-border py-3 first:border-t-0">
                <div className="min-w-0">
                  <div className="text-body-airbnb">{tariff.name}</div>
                  {isStaysZone(zone) && tariff.pricingMode && (
                    <div className="text-caption-airbnb text-muted-foreground">{formatTariffPricingLabel(tariff)}</div>
                  )}
                </div>
                <div className="flex items-center gap-3.5">
                  {tariff.pricingMode !== "fixed" && (
                    <Money value={Number(tariff.price)} className="text-[0.96875rem] font-bold" />
                  )}
                  <IconActionButton icon={Pencil} onClick={() => openEditTariff(tariff)} label={t.zoneDetail.editTariff} />
                  <IconActionButton
                    icon={Trash2}
                    onClick={() => openDeleteTariffConfirm(tariff)}
                    label={t.zoneDetail.deleteTariffAction}
                    destructive
                  />
                </div>
              </div>
            ))}

            {!tariffLimitReached && (
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full gap-1.5"
                  onClick={() => setCreateTariffOpen(true)}
                >
                  <Plus />
                  {t.zoneDetail.addTariffButton}
                </Button>
              </PressableScale>
            )}
          </SpringCard>
          )}

          {/* Активы — общая карточка для всех режимов с активами (счётчики,
              пуски, Прибывания): по ним у "Прибываний" тоже
              стартуются пуски в PWA оператора (тайлы экрана зоны), поэтому
              владельцу нужно их так же заводить/фоткать/раскрашивать, как и
              везде (запрос пользователя 2026-07-16: "как в других зонах"). */}
          {zone.accountingMode !== "cash_only" && (
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
                    {isStaysZone(zone) && (
                      <p className="text-caption-airbnb text-muted-foreground">
                        {assetHasValidTariff(asset)
                          ? `${t.zoneDetail.assetTariffLabel}: ${assetTariffName(asset)}`
                          : t.zoneDetail.assetTariffNotLinked}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isStaysZone(zone) && !assetHasValidTariff(asset) && (
                    <span title={t.zoneDetail.assetTariffMissingWarning} className="shrink-0">
                      <TriangleAlert
                        role="img"
                        aria-label={t.zoneDetail.assetTariffMissingWarning}
                        className="size-6 text-destructive"
                      />
                    </span>
                  )}
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
                variant="outline"
                size="sm"
                className="mt-3 w-full gap-1.5"
                onClick={() => setCreateAssetOpen(true)}
              >
                <Plus />
                {t.zoneDetail.addAssetButton}
              </Button>
            </PressableScale>
          </SpringCard>
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
              {ZONE_ACCOUNTING_MODES.map((mode) => {
                const ModeIcon = ACCOUNTING_MODE_ICON[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => changeAccountingMode(mode)}
                    className="flex w-full items-center gap-3 border-t border-border px-3 py-2.5 text-left first:border-t-0"
                  >
                    <ModeIcon className="size-5 shrink-0 text-muted-foreground" />
                    <span className="grow">
                      <span className="block text-body-airbnb">{ACCOUNTING_MODE_LABEL[mode](t)}</span>
                      <span className="block text-caption-airbnb">{ACCOUNTING_MODE_HINT[mode](t)}</span>
                    </span>
                    {zone.accountingMode === mode && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
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
          {!(isStaysZone(zone) && tariffPricingMode === "fixed") && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="tariffPrice">
                {isStaysZone(zone) ? t.zoneDetail.gameRoomRateLabel : t.zoneDetail.tariffPriceLabel}
              </Label>
              {isStaysZone(zone) && tariffPricingMode === "per_minute" ? (
                <div className="flex items-center gap-2">
                  <MoneyInput
                    id="tariffPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    scale="lg"
                    className="h-14 flex-1 border-2 text-lg"
                    value={tariffPrice}
                    onChange={(e) => setTariffPrice(e.target.value)}
                    required
                  />
                  <PressableScale>
                    <SaveButton type="submit" className="h-14 text-base font-bold" saved={addTariffSaved} />
                  </PressableScale>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <MoneyInput
                    id="tariffPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    scale="lg"
                    className="h-14 flex-1 border-2 text-lg"
                    value={tariffPrice}
                    onChange={(e) => setTariffPrice(e.target.value)}
                    required
                  />
                  <PressableScale>
                    <SaveButton type="submit" className="h-14 text-base font-bold" saved={addTariffSaved} />
                  </PressableScale>
                </div>
              )}
              {isStaysZone(zone) && tariffPricingMode === "per_minute" && (
                <p className="text-caption-airbnb text-muted-foreground">{t.zoneDetail.gameRoomRateHint}</p>
              )}
            </div>
          )}
          {isStaysZone(zone) && (
            <>
              <SegmentedTabs
                shape="control"
                options={[
                  { key: "fixed" as const, label: t.zoneDetail.gameRoomPricingModeFixed },
                  { key: "per_minute" as const, label: t.zoneDetail.gameRoomPricingModePerMinute },
                ]}
                value={tariffPricingMode}
                onChange={setTariffPricingMode}
              />
              {tariffPricingMode === "fixed" ? (
                <TariffOptionsEditor options={tariffOptions} onChange={setTariffOptions} />
              ) : (
                <p className="text-caption-airbnb text-muted-foreground">{t.zoneDetail.gameRoomRoundingUpNote}</p>
              )}
            </>
          )}
          {tariffError && <p className="text-sm text-destructive">{tariffError}</p>}
          {isStaysZone(zone) && tariffPricingMode === "fixed" && (
            <PressableScale>
              <SaveButton type="submit" className="h-12 w-full" saved={addTariffSaved} />
            </PressableScale>
          )}
        </form>
      </BottomSheet>

      <BottomSheet open={tariffKebab !== null} onClose={() => setTariffKebab(null)}>
        {tariffKebab && tariffKebabView === "edit" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zoneDetail.editTariff}</h2>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editTariffName">{t.zoneDetail.tariffNameLabel}</Label>
              <Input id="editTariffName" autoFocus value={editTariffName} onChange={(e) => setEditTariffName(e.target.value)} />
            </div>
            {isStaysZone(zone) && (
              <SegmentedTabs
                shape="control"
                options={[
                  { key: "fixed" as const, label: t.zoneDetail.gameRoomPricingModeFixed },
                  { key: "per_minute" as const, label: t.zoneDetail.gameRoomPricingModePerMinute },
                ]}
                value={editTariffPricingMode}
                onChange={setEditTariffPricingMode}
              />
            )}
            {!(isStaysZone(zone) && editTariffPricingMode === "fixed") && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="editTariffPrice">
                  {isStaysZone(zone) ? t.zoneDetail.gameRoomRateLabel : t.zoneDetail.tariffPriceLabel}
                </Label>
                {isStaysZone(zone) && editTariffPricingMode === "per_minute" ? (
                  <div className="flex items-center gap-2">
                    <MoneyInput
                      id="editTariffPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      scale="lg"
                      className="h-14 flex-1 border-2 text-lg"
                      value={editTariffPrice}
                      onChange={(e) => setEditTariffPrice(e.target.value)}
                    />
                    <PressableScale>
                      <SaveButton
                        className="h-14 text-base font-bold"
                        onClick={confirmEditTariff}
                        saved={editTariffSaved}
                      />
                    </PressableScale>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <MoneyInput
                      id="editTariffPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      scale="lg"
                      className="h-14 flex-1 border-2 text-lg"
                      value={editTariffPrice}
                      onChange={(e) => setEditTariffPrice(e.target.value)}
                    />
                    <PressableScale>
                      <SaveButton
                        className="h-14 text-base font-bold"
                        onClick={confirmEditTariff}
                        saved={editTariffSaved}
                      />
                    </PressableScale>
                  </div>
                )}
                {isStaysZone(zone) && editTariffPricingMode === "per_minute" && (
                  <p className="text-caption-airbnb text-muted-foreground">{t.zoneDetail.gameRoomRateHint}</p>
                )}
              </div>
            )}
            {isStaysZone(zone) &&
              (editTariffPricingMode === "fixed" ? (
                <TariffOptionsEditor options={editTariffOptions} onChange={setEditTariffOptions} />
              ) : (
                <p className="text-caption-airbnb text-muted-foreground">{t.zoneDetail.gameRoomRoundingUpNote}</p>
              ))}
            {editTariffError && <p className="text-sm text-destructive">{editTariffError}</p>}
            {isStaysZone(zone) && editTariffPricingMode === "fixed" && (
              <PressableScale>
                <SaveButton className="h-12 w-full" onClick={confirmEditTariff} saved={editTariffSaved} />
              </PressableScale>
            )}
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
          {isStaysZone(zone) && (
            <div className="flex flex-col gap-1">
              <Label>
                {t.zoneDetail.assetTariffLabel}{" "}
                <span className="font-normal text-muted-foreground">({t.common.optional})</span>
              </Label>
              <Select
                value={assetTariffId}
                onValueChange={(v) => setAssetTariffId(v ?? "")}
                items={zone.tariffs.map((tf) => ({ value: tf.id, label: tf.name }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.zoneDetail.assetTariffPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {zone.tariffs.map((tf) => (
                    <SelectItem key={tf.id} value={tf.id}>
                      {tf.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {zone.tariffs.length === 0 && (
                <p className="text-caption-airbnb text-muted-foreground">{t.zoneDetail.assetTariffEmptyHint}</p>
              )}
            </div>
          )}
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
            {isStaysZone(zone) && (
              <div className="flex flex-col gap-1">
                <Label>
                  {t.zoneDetail.assetTariffLabel}{" "}
                  <span className="font-normal text-muted-foreground">({t.common.optional})</span>
                </Label>
                <Select
                  value={editAssetTariffId}
                  onValueChange={(v) => setEditAssetTariffId(v ?? "")}
                  items={zone.tariffs.map((tf) => ({ value: tf.id, label: tf.name }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.zoneDetail.assetTariffPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {zone.tariffs.map((tf) => (
                      <SelectItem key={tf.id} value={tf.id}>
                        {tf.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {zone.tariffs.length === 0 && (
                  <p className="text-caption-airbnb text-muted-foreground">{t.zoneDetail.assetTariffEmptyHint}</p>
                )}
              </div>
            )}
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
