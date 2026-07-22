"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Link2,
  ImagePlus,
  ChevronRight,
  MapPin,
  Pause,
  Play,
  TabletSmartphone,
  ArrowLeftRight,
  PrinterCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/time-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Skeleton, SkeletonListRows } from "@/components/ui/skeleton";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconPicker, IconPickerSheet } from "@/components/icon-picker";
import { KebabButton, ActionSheetItem, IconActionButton } from "@/components/kebab-menu";
import { ActiveStatusIcon } from "@/components/active-status-icon";
import { ActionToast } from "@/components/action-toast";
import { TileIcon } from "@/components/tile-icon";
import { QrCode } from "@/components/qr-code";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useActionToast } from "@/hooks/use-action-toast";
import { playSaveDing } from "@/lib/beep";

interface PointDeviceInfo {
  id: string;
  label: string | null;
  activated: boolean;
  roaming: boolean;
  hasPrinter: boolean;
}

interface PointInfo {
  id: string;
  name: string;
  address: string | null;
  iconKey: string | null;
  zonesCount: number;
  devices: PointDeviceInfo[];
  active: boolean;
}

// docs/spec/08-landing.md, "Где нас найти" — редактируются в настройках
// Точки (кебаб "Адрес и часы работы"), не в разделе Лендинг.
interface DayHoursForm {
  weekday: number;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
}

const DEFAULT_HOURS: DayHoursForm[] = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  isOpen: false,
  opensAt: "09:00",
  closesAt: "18:00",
}));

// weekday: 0=понедельник..6=воскресенье (docs/spec/08-landing.md, PointOpeningHours).
function WEEKDAY_LABELS(t: ReturnType<typeof useI18n>): string[] {
  return [
    t.points.weekdayMon,
    t.points.weekdayTue,
    t.points.weekdayWed,
    t.points.weekdayThu,
    t.points.weekdayFri,
    t.points.weekdaySat,
    t.points.weekdaySun,
  ];
}

type PointKebabView = "menu" | "rename" | "icon" | "location" | "confirm-delete";
type DeviceKebabView = "rename" | "confirm-delete";

export default function PointsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [points, setPoints] = useState<PointInfo[]>([]);
  const { message: toastMessage, variant: toastVariant, flash: flashToast } = useActionToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [iconKey, setIconKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { saved: createSaved, pulse: createPulse } = useSavePulse();

  const [deviceSheetPointId, setDeviceSheetPointId] = useState<string | null>(null);
  const { saved: createDeviceSaved, pulse: createDevicePulse } = useSavePulse();
  const [deviceLabel, setDeviceLabel] = useState("");
  const [deviceRoaming, setDeviceRoaming] = useState(false);
  const [deviceHasPrinter, setDeviceHasPrinter] = useState(false);
  const [installLinks, setInstallLinks] = useState<Record<string, string>>({});
  const [qrOpenFor, setQrOpenFor] = useState<string | null>(null);

  const [pointKebab, setPointKebab] = useState<PointInfo | null>(null);
  const [pointKebabView, setPointKebabView] = useState<PointKebabView>("menu");
  const [renamePointValue, setRenamePointValue] = useState("");
  const { saved: renamePointSaved, pulse: renamePointPulse } = useSavePulse();
  const [pointActionError, setPointActionError] = useState<string | null>(null);
  const { saved: pointDeleted, pulse: pointDeletePulse } = useSavePulse();

  const [locAddress, setLocAddress] = useState("");
  const [locCity, setLocCity] = useState("");
  const [locLatitude, setLocLatitude] = useState("");
  const [locLongitude, setLocLongitude] = useState("");
  const [locHoursNote, setLocHoursNote] = useState("");
  const [locMapsUrl, setLocMapsUrl] = useState("");
  const [locHours, setLocHours] = useState<DayHoursForm[]>(DEFAULT_HOURS);
  const [locLoading, setLocLoading] = useState(false);
  const [locSaving, setLocSaving] = useState(false);
  const { saved: locSaved, pulse: locPulse } = useSavePulse();

  const [deviceKebab, setDeviceKebab] = useState<{ pointId: string; device: PointDeviceInfo } | null>(null);
  const { saved: deviceDeleted, pulse: deviceDeletePulse } = useSavePulse();
  const [deviceKebabView, setDeviceKebabView] = useState<DeviceKebabView>("rename");
  const [renameDeviceValue, setRenameDeviceValue] = useState("");
  const [renameDeviceRoaming, setRenameDeviceRoaming] = useState(false);
  // Модуль печати (запрос пользователя 2026-07-20) — ручной тумблер "на этом
  // устройстве есть принтер", автоопределения нет и быть не может.
  const [renameDeviceHasPrinter, setRenameDeviceHasPrinter] = useState(false);
  const { saved: renameDeviceSaved, pulse: renameDevicePulse } = useSavePulse();
  const [copiedDeviceId, setCopiedDeviceId] = useState<string | null>(null);

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

  // Пока владелец держит открытым QR конкретного устройства (ждёт, пока
  // сотрудник отсканирует и активирует), опрашиваем список точек — как
  // только устройство становится activated, QR сам скрывается и список
  // обновляется, без ручного обновления страницы (решение пользователя
  // 2026-07-14, реальный кейс: после фикса бага с манифестом PWA владелец
  // тестировал активацию заново и ожидал видеть результат сразу). Опрос
  // ограничен по времени (10 минут) — если QR оставили открытым и забыли,
  // не долбим сервер бесконечно.
  useEffect(() => {
    if (!qrOpenFor) return;
    const deviceId = qrOpenFor;
    const startedAt = Date.now();
    const MAX_POLL_MS = 10 * 60 * 1000;

    const interval = setInterval(async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        clearInterval(interval);
        return;
      }
      const res = await fetch("/api/points");
      if (!res.ok) return;
      const data = await res.json();
      const nextPoints: PointInfo[] = data.points ?? [];
      setPoints(nextPoints);
      const device = nextPoints.flatMap((p) => p.devices).find((d) => d.id === deviceId);
      if (device?.activated) {
        setQrOpenFor(null);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [qrOpenFor]);

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
      await loadPoints();
      createPulse(() => {
        setName("");
        setAddress("");
        setIconKey(null);
        setCreateOpen(false);
      });
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
      body: JSON.stringify({ label: deviceLabel, roaming: deviceRoaming, hasPrinter: deviceHasPrinter }),
    });
    const data = await res.json();
    if (res.ok) {
      setInstallLinks((prev) => ({ ...prev, [data.id]: data.installLink }));
      await loadPoints();
      createDevicePulse(() => {
        setDeviceLabel("");
        setDeviceRoaming(false);
        setDeviceHasPrinter(false);
        setDeviceSheetPointId(null);
      });
    }
  }

  function openPointKebab(point: PointInfo) {
    setPointKebab(point);
    setPointKebabView("menu");
    setRenamePointValue(point.name);
    setPointActionError(null);
  }

  async function openLocationView() {
    if (!pointKebab) return;
    setPointKebabView("location");
    setLocLoading(true);
    const [pointRes, hoursRes] = await Promise.all([
      fetch(`/api/points/${pointKebab.id}`),
      fetch(`/api/points/${pointKebab.id}/opening-hours`),
    ]);
    const pointData = await pointRes.json();
    const hoursData = await hoursRes.json();
    setLocAddress(pointData.address ?? "");
    setLocCity(pointData.city ?? "");
    setLocLatitude(pointData.latitude != null ? String(pointData.latitude) : "");
    setLocLongitude(pointData.longitude != null ? String(pointData.longitude) : "");
    setLocHoursNote(pointData.hoursNote ?? "");
    setLocMapsUrl(pointData.mapsUrl ?? "");
    const existingHours: DayHoursForm[] | undefined = hoursData.hours?.length
      ? hoursData.hours.map((h: { weekday: number; isOpen: boolean; opensAt: string | null; closesAt: string | null }) => ({
          weekday: h.weekday,
          isOpen: h.isOpen,
          opensAt: h.opensAt ?? "09:00",
          closesAt: h.closesAt ?? "18:00",
        }))
      : undefined;
    setLocHours(existingHours ?? DEFAULT_HOURS);
    setLocLoading(false);
  }

  async function saveLocation() {
    if (!pointKebab) return;
    setLocSaving(true);
    const latitude = locLatitude.trim() ? Number(locLatitude) : null;
    const longitude = locLongitude.trim() ? Number(locLongitude) : null;
    try {
      await fetch(`/api/points/${pointKebab.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: locAddress,
          city: locCity,
          latitude,
          longitude,
          hoursNote: locHoursNote,
          mapsUrl: locMapsUrl,
        }),
      });
      await fetch(`/api/points/${pointKebab.id}/opening-hours`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: locHours.map((d) => ({
            weekday: d.weekday,
            isOpen: d.isOpen,
            opensAt: d.isOpen ? d.opensAt : null,
            closesAt: d.isOpen ? d.closesAt : null,
          })),
        }),
      });
      await loadPoints();
      locPulse(() => setPointKebab(null));
    } finally {
      setLocSaving(false);
    }
  }

  async function confirmRenamePoint() {
    if (!pointKebab || !renamePointValue.trim()) return;
    await fetch(`/api/points/${pointKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renamePointValue }),
    });
    await loadPoints();
    renamePointPulse(() => setPointKebab(null));
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

  // Принимает точку напрямую, а не только через pointKebab (запрос
  // пользователя 2026-07-22: иконка статуса в самом списке тоже кликабельна,
  // без захода в кебаб-меню) — кебаб-пункт "Деактивировать"/"Активировать"
  // продолжает работать через тот же вызов с pointKebab.
  async function togglePointActive(point: PointInfo) {
    const nextActive = !point.active;
    await fetch(`/api/points/${point.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nextActive }),
    });
    setPointKebab(null);
    await loadPoints();
    // Сообщение по типу "Заказ не найден" у Сотрудника (запрос пользователя
    // 2026-07-22) — подтверждает результат тапа по иконке статуса.
    playSaveDing();
    flashToast(nextActive ? t.points.pointActiveChip : t.points.pointInactiveChip, nextActive ? "success" : "error");
  }

  async function confirmDeletePoint() {
    if (!pointKebab) return;
    const res = await fetch(`/api/points/${pointKebab.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setPointActionError(data.error ?? "Не удалось удалить точку");
      return;
    }
    await loadPoints();
    pointDeletePulse(() => setPointKebab(null));
  }

  // Кебаб с 2-3 действиями заменён прямыми кнопками (запрос пользователя
  // 2026-07-20: "в Устройствах для точки тоже вместо кебаб меню сделай две
  // кнопки"), тот же приём, что уже применён по всему проекту для кебабов с
  // одним-двумя действиями — открываем сразу нужный view, минуя view "menu".
  function openDeviceKebab(pointId: string, device: PointDeviceInfo, view: DeviceKebabView = "rename") {
    setDeviceKebab({ pointId, device });
    setDeviceKebabView(view);
    setRenameDeviceValue(device.label ?? "");
    setRenameDeviceRoaming(device.roaming);
    setRenameDeviceHasPrinter(device.hasPrinter);
  }

  async function confirmRenameDevice() {
    if (!deviceKebab) return;
    await fetch(`/api/points/${deviceKebab.pointId}/devices/${deviceKebab.device.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: renameDeviceValue, roaming: renameDeviceRoaming, hasPrinter: renameDeviceHasPrinter }),
    });
    await loadPoints();
    renameDevicePulse(() => setDeviceKebab(null));
  }

  async function copyActivationLink(deviceId: string) {
    const link = installLinks[deviceId];
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiedDeviceId(deviceId);
    setTimeout(() => setCopiedDeviceId((id) => (id === deviceId ? null : id)), 1500);
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
    await loadPoints();
    deviceDeletePulse(() => setDeviceKebab(null));
  }

  if (checking) {
    return (
      <OwnerShell>
        <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
          <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-24 rounded-lg" />
            </div>
            <Skeleton className="mb-4 mt-1.5 h-3 w-48" />
            <div className="flex flex-col gap-3.5">
              <SkeletonListRows count={3} />
            </div>
          </div>
        </div>
      </OwnerShell>
    );
  }

  return (
    <OwnerShell>
      <ActionToast message={toastMessage} variant={toastVariant} />
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.points.title}</h1>
            <PressableScale>
              <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={() => setCreateOpen(true)}>
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
                return (
                  <StaggerItem key={point.id}>
                    <SpringCard animate={false} className={cn(!point.active && "grayscale")}>
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/points/${point.id}`}
                          className="-m-1.5 flex min-w-0 grow items-center gap-3 rounded-control bg-muted/50 p-1.5 transition-colors hover:bg-muted active:bg-muted"
                        >
                          <TileIcon iconKey={point.iconKey} />
                          <div className="min-w-0 grow">
                            <div className="text-card-title">{point.name}</div>
                            {/* Без "N устройство(а) активировано" (запрос пользователя
                                2026-07-16: "не надо, так как итак видно эти
                                устройства" — список устройств уже показан ниже).
                                Чип статуса — в одном ряду с подписью зон, не с
                                названием — длинное название точки иначе
                                сжималось из-за соседнего чипа. */}
                            {/* div, не p — ActiveStatusIcon оборачивает кнопку в
                                PressableScale (motion.div), а div внутри p
                                невалиден и молча обрывает тег раньше времени. */}
                            <div className="flex flex-wrap items-center gap-1.5 text-caption-airbnb">
                              <span>
                                {point.zonesCount} {t.points.zonesSuffix}
                              </span>
                              {/* Не кнопка (запрос пользователя 2026-07-22) —
                                  переключение только через ActionSheetItem
                                  в кебаб-меню точки ниже. */}
                              <ActiveStatusIcon
                                active={point.active}
                                activeLabel={t.points.pointActiveChip}
                                inactiveLabel={t.points.pointInactiveChip}
                              />
                            </div>
                          </div>
                          <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
                        </Link>
                        <KebabButton onClick={() => openPointKebab(point)} label={t.points.renamePoint} />
                      </div>

                      {point.devices.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
                          <span className="text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                            {t.points.devicesTitle}
                          </span>
                          {point.devices.map((device) => (
                            <div key={device.id} className="flex flex-col gap-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 text-body-airbnb">
                                    <TabletSmartphone className="size-6 shrink-0 text-muted-foreground" />
                                    {device.label ?? t.points.unnamedDevice}
                                    {/* Иконка вместо текстовой плашки (запрос пользователя
                                        2026-07-21) — тот же приём, что у Роуминга/Есть
                                        принтера ниже: активация не требует отдельного слова.
                                        square-check-big вместо circle-check-big и видна ВСЕГДА,
                                        не только когда активно (запрос пользователя 2026-07-22:
                                        единообразная иконка активности по всему проекту) —
                                        неактивированное устройство теперь тоже помечено, серым
                                        triangle-alert, а не молчанием, как раньше. Без onToggle
                                        (не кнопка) — активация устройства это claim самим
                                        оператором через код на физическом устройстве, у
                                        Владельца нет действия "активировать"/"деактивировать"
                                        устройство напрямую (есть только переименование и
                                        удаление), поэтому тут просто индикатор. */}
                                    <ActiveStatusIcon
                                      active={device.activated}
                                      activeLabel={t.points.deviceActivated}
                                      inactiveLabel={t.points.deviceAwaiting}
                                    />
                                    {/* Иконки вместо текстовых плашек (запрос пользователя
                                        2026-07-20) — Роуминг/Есть принтер не требуют
                                        отдельного слова, компактнее рядом с названием. */}
                                    {device.roaming && (
                                      <ArrowLeftRight
                                        className="size-4 shrink-0 text-warning"
                                        aria-label={t.points.roamingChip}
                                      >
                                        <title>{t.points.roamingChip}</title>
                                      </ArrowLeftRight>
                                    )}
                                    {device.hasPrinter && (
                                      <PrinterCheck
                                        className="size-4 shrink-0 text-primary"
                                        aria-label={t.points.hasPrinterLabel}
                                      >
                                        <title>{t.points.hasPrinterLabel}</title>
                                      </PrinterCheck>
                                    )}
                                  </div>
                                  {!device.activated && (
                                    <p className="text-caption-airbnb">{t.points.deviceAwaiting}</p>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <IconActionButton
                                    icon={Pencil}
                                    onClick={() => openDeviceKebab(point.id, device, "rename")}
                                    label={t.points.renameDevice}
                                  />
                                  <IconActionButton
                                    icon={Trash2}
                                    onClick={() => openDeviceKebab(point.id, device, "confirm-delete")}
                                    label={t.points.deleteDevice}
                                    destructive
                                  />
                                </div>
                              </div>
                              {/* Ссылка/QR активации теряет смысл, как только устройство
                                  реально активировано (запрос пользователя 2026-07-14) —
                                  раньше сама картинка QR схлопывалась при активации
                                  (см. опрос выше), но сама ссылка-переключатель оставалась
                                  видимой, пока не обновится страница целиком. */}
                              {installLinks[device.id] && !device.activated && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      className="w-fit text-caption-airbnb font-semibold text-primary underline underline-offset-2"
                                      onClick={() => setQrOpenFor(qrOpenFor === device.id ? null : device.id)}
                                    >
                                      {qrOpenFor === device.id ? t.points.hideQr : t.points.showQr}
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex w-fit items-center gap-1 text-caption-airbnb font-semibold text-primary underline underline-offset-2"
                                      onClick={() => copyActivationLink(device.id)}
                                    >
                                      <Link2 className="size-3.5 shrink-0" />
                                      {copiedDeviceId === device.id ? t.instructions.linkCopiedToast : t.points.copyActivationLink}
                                    </button>
                                  </div>
                                  {qrOpenFor === device.id && (
                                    <QrCode value={installLinks[device.id]} alt={t.points.qrAlt} />
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <PressableScale>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3 w-full gap-1.5 rounded-lg"
                          onClick={() => {
                            setDeviceSheetPointId(point.id);
                            setDeviceLabel("");
                            setDeviceRoaming(false);
                          }}
                        >
                          <Plus />
                          {t.points.addDeviceButton}
                        </Button>
                      </PressableScale>
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
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.points.newPointTitle}</h2>
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
            <SaveButton type="submit" disabled={loading} className="h-12 w-full" saved={createSaved} />
          </PressableScale>
        </form>
      </BottomSheet>

      <BottomSheet open={deviceSheetPointId !== null} onClose={() => setDeviceSheetPointId(null)}>
        <form onSubmit={handleCreateDevice} className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.points.newDeviceTitle}</h2>
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
          <div className="flex items-center justify-between rounded-control border border-border p-3">
            <span>
              <span className="block text-body-airbnb">{t.points.roamingLabel}</span>
              <span className="mt-0.5 block text-caption-airbnb">{t.points.roamingHint}</span>
            </span>
            <Switch checked={deviceRoaming} onCheckedChange={setDeviceRoaming} className="shrink-0" />
          </div>
          {/* Реальный баг (запрос пользователя 2026-07-21): тумблер был только
              в форме редактирования уже созданного устройства — при СОЗДАНИИ
              нового его не было вовсе, значение всегда уходило false. */}
          <div className="flex items-center justify-between rounded-control border border-border p-3">
            <span>
              <span className="block text-body-airbnb">{t.points.hasPrinterLabel}</span>
              <span className="mt-0.5 block text-caption-airbnb">{t.points.hasPrinterHint}</span>
            </span>
            <Switch checked={deviceHasPrinter} onCheckedChange={setDeviceHasPrinter} className="shrink-0" />
          </div>
          <PressableScale>
            <SaveButton type="submit" className="h-12 w-full" saved={createDeviceSaved} />
          </PressableScale>
        </form>
      </BottomSheet>

      <BottomSheet open={pointKebab !== null && pointKebabView !== "icon"} onClose={() => setPointKebab(null)}>
        {pointKebab && pointKebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{pointKebab.name}</h2>
            <ActionSheetItem icon={Pencil} onClick={() => setPointKebabView("rename")}>
              {t.points.renamePoint}
            </ActionSheetItem>
            <ActionSheetItem icon={ImagePlus} onClick={() => setPointKebabView("icon")}>
              {t.common.changeIcon}
            </ActionSheetItem>
            <ActionSheetItem icon={MapPin} onClick={openLocationView}>
              {t.points.editLocationAction}
            </ActionSheetItem>
            <ActionSheetItem icon={pointKebab.active ? Pause : Play} onClick={() => togglePointActive(pointKebab)}>
              {pointKebab.active ? t.points.deactivatePoint : t.points.activatePoint}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setPointKebabView("confirm-delete")}>
              {t.points.deletePoint}
            </ActionSheetItem>
          </div>
        )}
        {pointKebab && pointKebabView === "location" && (
          <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pt-2 pb-1">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.points.editLocationTitle}</h2>
            {locLoading ? (
              <p className="text-body-airbnb text-muted-foreground">{t.common.loading}</p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="locAddress">{t.points.addressLabel}</Label>
                  <Input id="locAddress" value={locAddress} onChange={(e) => setLocAddress(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="locCity">{t.points.cityLabel}</Label>
                  <Input id="locCity" value={locCity} onChange={(e) => setLocCity(e.target.value)} />
                  <p className="text-caption-airbnb">{t.points.cityHint}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="locMapsUrl">{t.points.mapsUrlLabel}</Label>
                  <Input
                    id="locMapsUrl"
                    placeholder="https://maps.app.goo.gl/… или yandex.ru/maps/…"
                    value={locMapsUrl}
                    onChange={(e) => setLocMapsUrl(e.target.value)}
                  />
                  <p className="text-caption-airbnb">{t.points.mapsUrlHint}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="locLat">{t.points.latitudeLabel}</Label>
                    <Input
                      id="locLat"
                      inputMode="decimal"
                      value={locLatitude}
                      onChange={(e) => setLocLatitude(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="locLng">{t.points.longitudeLabel}</Label>
                    <Input
                      id="locLng"
                      inputMode="decimal"
                      value={locLongitude}
                      onChange={(e) => setLocLongitude(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-caption-airbnb">{t.points.coordsHint}</p>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="locHoursNote">{t.points.hoursNoteLabel}</Label>
                  <Input
                    id="locHoursNote"
                    placeholder={t.points.hoursNotePlaceholder}
                    value={locHoursNote}
                    onChange={(e) => setLocHoursNote(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t.points.openingHoursTitle}</Label>
                  {locHours.map((day, i) => (
                    <div key={day.weekday} className="rounded-control border border-border p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-body-airbnb font-semibold">{WEEKDAY_LABELS(t)[day.weekday]}</span>
                        <Switch
                          checked={day.isOpen}
                          onCheckedChange={(checked) =>
                            setLocHours((prev) => prev.map((d, idx) => (idx === i ? { ...d, isOpen: checked } : d)))
                          }
                        />
                      </div>
                      {day.isOpen && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <Label className="text-caption-airbnb">{t.points.opensAtLabel}</Label>
                            <TimeInput
                              value={day.opensAt}
                              onChange={(e) =>
                                setLocHours((prev) =>
                                  prev.map((d, idx) => (idx === i ? { ...d, opensAt: e.target.value } : d))
                                )
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label className="text-caption-airbnb">{t.points.closesAtLabel}</Label>
                            <TimeInput
                              value={day.closesAt}
                              onChange={(e) =>
                                setLocHours((prev) =>
                                  prev.map((d, idx) => (idx === i ? { ...d, closesAt: e.target.value } : d))
                                )
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            <PressableScale>
              <SaveButton className="h-12 w-full" disabled={locSaving || locLoading} onClick={saveLocation} saved={locSaved} />
            </PressableScale>
          </div>
        )}
        {pointKebab && pointKebabView === "rename" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.points.renamePoint}</h2>
            <Input autoFocus value={renamePointValue} onChange={(e) => setRenamePointValue(e.target.value)} />
            <PressableScale>
              <SaveButton className="h-12 w-full" onClick={confirmRenamePoint} saved={renamePointSaved} />
            </PressableScale>
          </div>
        )}
        {pointKebab && pointKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.points.deletePoint}</h2>
            <p className="text-body-airbnb">{t.points.confirmDeletePoint}</p>
            {pointActionError && <p className="text-sm text-destructive">{pointActionError}</p>}
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={confirmDeletePoint} deleted={pointDeleted} />
            </PressableScale>
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
        {deviceKebab && deviceKebabView === "rename" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.points.renameDevice}</h2>
            <Input
              autoFocus
              placeholder={t.points.deviceLabelPlaceholder}
              value={renameDeviceValue}
              onChange={(e) => setRenameDeviceValue(e.target.value)}
            />
            {/* Роуминг переключаем и здесь, не только при создании ссылки
                активации (запрос пользователя 2026-07-19: "после активации
                устройства я не могу уже включить Роуминг") — то же поле
                PointDevice.roaming, никакой переустановки PWA не требуется. */}
            <div className="flex items-center justify-between rounded-control border border-border p-3">
              <span>
                <span className="block text-body-airbnb">{t.points.roamingLabel}</span>
                <span className="mt-0.5 block text-caption-airbnb">{t.points.roamingHint}</span>
              </span>
              <Switch checked={renameDeviceRoaming} onCheckedChange={setRenameDeviceRoaming} className="shrink-0" />
            </div>
            {/* Модуль печати (запрос пользователя 2026-07-20) — ручной
                тумблер, у веб-платформы нет способа определить наличие
                принтера автоматически. Владелец включает только там, где
                физически стоит принтер, настроенный в ОС этого устройства. */}
            <div className="flex items-center justify-between rounded-control border border-border p-3">
              <span>
                <span className="block text-body-airbnb">{t.points.hasPrinterLabel}</span>
                <span className="mt-0.5 block text-caption-airbnb">{t.points.hasPrinterHint}</span>
              </span>
              <Switch checked={renameDeviceHasPrinter} onCheckedChange={setRenameDeviceHasPrinter} className="shrink-0" />
            </div>
            <PressableScale>
              <SaveButton className="h-12 w-full" onClick={confirmRenameDevice} saved={renameDeviceSaved} />
            </PressableScale>
          </div>
        )}
        {deviceKebab && deviceKebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.points.deleteDevice}</h2>
            <p className="text-body-airbnb">{t.points.confirmDeleteDevice}</p>
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={confirmDeleteDevice} deleted={deviceDeleted} />
            </PressableScale>
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}
