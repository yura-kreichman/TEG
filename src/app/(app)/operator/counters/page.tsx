"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, RefreshCcw, Wallet, Trash2, MapPin, Layers, Banknote, CreditCard, History, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { BackLink } from "@/components/back-link";
import { IconActionButton } from "@/components/kebab-menu";
import { SpringCard } from "@/components/spring-card";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Skeleton, SkeletonListRows } from "@/components/ui/skeleton";
import { AbonementTopupFlow, type SpendZoneCtx } from "@/components/abonement-topup-flow";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { SplitPaymentSheet } from "@/components/split-payment-sheet";
import type { PaymentLegInput } from "@/lib/payment-split";
import { PaymentMethodIcon } from "@/components/payment-method-icon";
import { Money } from "@/components/money";
import { useI18n } from "@/components/i18n-provider";
import { formatTime } from "@/lib/datetime-format";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { unlockBeep, playConfirmChime, playErrorChime } from "@/lib/beep";
import { useActionToast } from "@/hooks/use-action-toast";
import { ActionToast } from "@/components/action-toast";

const TAP_ALL_ZONES = "all";
const TAP_ZONE_FILTER_KEY = "countersTapZoneFilter";
const TAP_SPLIT_METHODS = ["cash", "mobile", "abonement"] as const;

interface CounterZone {
  id: string;
  name: string;
  iconKey: string | null;
}

interface TapTariff {
  id: string;
  name: string;
  price: number;
}

interface TapAsset {
  id: string;
  name: string;
  iconKey: string | null;
  photoUrl: string | null;
  colorTag: string;
  active: boolean;
}

interface TapZone {
  id: string;
  name: string;
  iconKey: string | null;
  tariffs: TapTariff[];
  assets: TapAsset[];
}

interface ReturnEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  createdAt: string;
}

interface RecentTap {
  id: string;
  zoneId: string;
  assetId: string;
  assetName: string;
  tariffId: string;
  tariffName: string;
  paymentMethod: "cash" | "mobile" | "abonement" | null;
  voidedAt: string | null;
  createdAt: string;
}

/**
 * Пункт нижнего бара "Счётчики" (запрос пользователя 2026-07-24) — раньше
 * Сотрудник для зон режима "Счётчики" шёл в "Клиенты" за списанием с
 * баланса, а возвраты/тестовые пуски вспоминал "из головы" на мастере сдачи
 * итогов ("Немного не единообразный интерфейс... надо запоминать, что если
 * по Счётчикам, то заходить в Клиенты"). Теперь оба действия — тут, а сдача
 * итогов только суммирует эту же таблицу (см. submit-results/route.ts).
 * Видим в баре только когда у оператора есть хоть одна зона режима
 * "Счётчики" (operator-bottom-nav.tsx, hasCounters).
 */
export default function OperatorCountersPage() {
  const t = useI18n();
  const [zones, setZones] = useState<CounterZone[]>([]);
  const [events, setEvents] = useState<ReturnEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [returnSheetOpen, setReturnSheetOpen] = useState(false);
  const [returnZone, setReturnZone] = useState<CounterZone | null>(null);
  const [logging, setLogging] = useState(false);
  const { saved: returnSaved, pulse: returnPulse } = useSavePulse();

  const [spendSheetOpen, setSpendSheetOpen] = useState(false);
  // undefined — ещё грузится (кнопка "Списать с баланса" скрыта до ответа
  // сервера, тот же приём, что раньше был в /operator/abonements).
  const [spendZones, setSpendZones] = useState<SpendZoneCtx[] | undefined>(undefined);

  // Тапы-показания (запрос пользователя 2026-07-25: "то, что Сотрудник
  // натапал, и является прибавкой к счётчику") — зоны с включённым
  // Zone.countersTapAssistEnabled, тот же тайл-паттерн и способ оплаты
  // (Наличные/Безнал/Баланс с подтверждением "Точно?"), что у "Пусков"
  // (operator/launches/page.tsx) — разница только в том, что касса зоны
  // по-прежнему вводится агрегатом на Сдаче итогов (способ оплаты тут —
  // справочная пометка для cash/mobile, не автозаполнение кассы; для
  // "Баланс" — реальное списание, см. счёт-эндпоинт).
  const [tapZones, setTapZones] = useState<TapZone[]>([]);
  const [tapCounts, setTapCounts] = useState<{ assetId: string; tariffId: string; count: number }[]>([]);
  const [tapFlow, setTapFlow] = useState<{ zoneId: string; assetId: string; tariffId?: string } | null>(null);
  const [tapSubmitting, setTapSubmitting] = useState(false);
  const [tapZoneFilter, setTapZoneFilter] = useState(TAP_ALL_ZONES);
  const [clientsEnabled, setClientsEnabled] = useState(true);
  // Оплата балансом на тапе (запрос пользователя 2026-07-25) — тот же
  // AbonementPaymentSheet, что у "Пусков": находит/пополняет кошелёк по
  // телефону, реальное списание делает logCounterTap (server-side, одним
  // запросом вместе с созданием тапа).
  const [abonementTarget, setAbonementTarget] = useState<{ zoneId: string; assetId: string; tariffId: string; amount: number } | null>(
    null
  );
  // Разбивка оплаты (запрос пользователя 2026-07-26) — та же логика захвата
  // цели в момент клика, что и у "Пусков" (splitStartTarget), т.к. tapFlow
  // обнуляется до открытия SplitPaymentSheet.
  const [splitTapTarget, setSplitTapTarget] = useState<{ zoneId: string; assetId: string; tariffId: string; amount: number } | null>(
    null
  );
  // "Возврат/тест" для tap-зон (запрос пользователя 2026-07-25: "у конкретных
  // активов был выбран конкретный метод оплаты" — размазывать вычет
  // пропорционально между наличными/безналом было неправильно) — вместо
  // зонного счётчика ZoneReturnEvent пометка ставится на КОНКРЕТНЫЙ тап
  // (CounterTapEvent.voidedAt), поэтому нужен список последних тапов
  // текущего периода, не просто агрегированные counts.
  const [recentTaps, setRecentTaps] = useState<RecentTap[]>([]);
  const [tapHistoryOpen, setTapHistoryOpen] = useState(false);
  const [tapHistoryBusyId, setTapHistoryBusyId] = useState<string | null>(null);
  const tapErrorToast = useActionToast();

  function loadEvents() {
    fetch("/api/operator/zone-return-events")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setZones(data.zones ?? []);
        setEvents(data.events ?? []);
      })
      .finally(() => setLoading(false));
  }

  function loadTapEvents() {
    fetch("/api/operator/counter-tap-events")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const loadedZones: TapZone[] = data.zones ?? [];
        setTapZones(loadedZones);
        setTapCounts(data.counts ?? []);
        setRecentTaps(data.recentTaps ?? []);
        setClientsEnabled(data.clientsEnabled !== false);
        // Запоминаем последний выбор фильтра зоны (тот же приём, что у
        // "Пусков") — внутри .then(), не синхронно в теле эффекта.
        const savedFilter = window.localStorage.getItem(TAP_ZONE_FILTER_KEY);
        if (savedFilter && loadedZones.some((z) => z.id === savedFilter)) {
          setTapZoneFilter(savedFilter);
        }
      });
  }

  useEffect(() => {
    loadEvents();
    loadTapEvents();
    fetch("/api/operator/counter-zones")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSpendZones(data?.zones ?? []));
  }, []);

  const allTapAssets = useMemo(
    () => tapZones.flatMap((z) => z.assets.map((a) => ({ ...a, zoneId: z.id, zoneName: z.name }))),
    [tapZones]
  );
  const filteredTapAssets =
    tapZoneFilter === TAP_ALL_ZONES ? allTapAssets : allTapAssets.filter((a) => a.zoneId === tapZoneFilter);
  const tapFilterZone = tapZones.find((z) => z.id === tapZoneFilter) ?? null;

  function tapCountFor(assetId: string, tariffId: string): number {
    return tapCounts.find((c) => c.assetId === assetId && c.tariffId === tariffId)?.count ?? 0;
  }
  function tapCountForAsset(assetId: string): number {
    return tapCounts.filter((c) => c.assetId === assetId).reduce((sum, c) => sum + c.count, 0);
  }

  // Тап по тайлу ВСЕГДА открывает шторку — даже при одном тарифе (та же
  // логика, что у "Пусков": там пропускается только шаг выбора тарифа,
  // подтверждение способа оплаты остаётся обязательным, запрос пользователя
  // 2026-07-25: "надо подтверждение 'Точно?', как и в Пусках").
  function handleTapTileTap(asset: TapAsset & { zoneId: string }) {
    if (!asset.active || tapSubmitting) return;
    const zone = tapZones.find((z) => z.id === asset.zoneId);
    if (!zone || zone.tariffs.length === 0) return;
    setTapFlow(
      zone.tariffs.length === 1
        ? { zoneId: zone.id, assetId: asset.id, tariffId: zone.tariffs[0].id }
        : { zoneId: zone.id, assetId: asset.id }
    );
  }

  async function logCounterTap(
    zoneId: string,
    assetId: string,
    tariffId: string,
    paymentMethod?: "cash" | "mobile" | "abonement",
    abonementWalletId?: string,
    legs?: PaymentLegInput[]
  ) {
    setTapSubmitting(true);
    try {
      const res = await fetch("/api/operator/counter-tap-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId, assetId, tariffId, paymentMethod, abonementWalletId, legs }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        playErrorChime();
        tapErrorToast.flash(data?.error ?? t.operatorApp.gameRoom.networkError, "error");
        return;
      }
      playConfirmChime();
      setTapFlow(null);
      setAbonementTarget(null);
      setSplitTapTarget(null);
      loadTapEvents();
    } catch {
      playErrorChime();
      tapErrorToast.flash(t.operatorApp.gameRoom.networkError, "error");
    } finally {
      setTapSubmitting(false);
    }
  }

  // Пометить/снять "Возврат/тест" у конкретного тапа (запрос пользователя
  // 2026-07-25) — обратимо, в отличие от deleteTap ниже.
  async function toggleTapVoid(tap: RecentTap) {
    if (tapHistoryBusyId) return;
    setTapHistoryBusyId(tap.id);
    const nextVoided = !tap.voidedAt;
    try {
      const res = await fetch(`/api/operator/counter-tap-events/${tap.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voided: nextVoided }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        tapErrorToast.flash(data?.error ?? t.operatorApp.gameRoom.networkError, "error");
        return;
      }
      const data = await res.json();
      setRecentTaps((prev) => prev.map((rt) => (rt.id === tap.id ? { ...rt, voidedAt: data.voidedAt } : rt)));
      loadTapEvents();
    } finally {
      setTapHistoryBusyId(null);
    }
  }

  // Отменить случайный тап целиком (опечатка, не было такого пуска вовсе) —
  // та же логика, что deleteEvent у "Возвратов", но для tap-зон.
  async function deleteTap(id: string) {
    setRecentTaps((prev) => prev.filter((rt) => rt.id !== id));
    await fetch(`/api/operator/counter-tap-events/${id}`, { method: "DELETE" }).catch(() => {});
    loadTapEvents();
  }

  function openReturnSheet() {
    setReturnSheetOpen(true);
    setReturnZone(zones.length === 1 ? zones[0] : null);
  }

  function countFor(zoneId: string): number {
    return events.filter((e) => e.zoneId === zoneId).length;
  }

  async function logReturn(zone: CounterZone) {
    if (logging) return;
    setLogging(true);
    try {
      const res = await fetch("/api/operator/zone-return-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: zone.id }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setEvents((prev) => [{ id: data.id, zoneId: zone.id, zoneName: zone.name, createdAt: data.createdAt }, ...prev]);
      // SaveButton сам шлёт "save-success-fly" при переходе saved false→true
      // (см. save-button.tsx) — раньше это дублировалось вручную здесь.
      returnPulse();
    } finally {
      setLogging(false);
    }
  }

  async function deleteEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/operator/zone-return-events/${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 md:max-w-xl lg:max-w-2xl">
          <Skeleton className="mb-2 h-7 w-32" />
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-24 rounded-card" />
          <SkeletonListRows count={3} />
        </div>
      </div>
    );
  }

  // "Списать с баланса" — полноэкранно, как раньше был отдельный экран
  // "Клиенты" (запрос пользователя 2026-07-24: "лучше не bottom-sheet, а
  // входить в окно, как было") — в отличие от "Возврат/тест" (короткое
  // действие, шторка уместна), тут телефон+нумпад+зона+тариф, полноценный
  // многошаговый флоу.
  if (spendSheetOpen) {
    return (
      <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 md:max-w-xl lg:max-w-2xl">
          <BackLink
            crumbs={[t.zonesList.accountingModeCounters, t.operatorApp.abonement.spendTitle]}
            onClick={() => setSpendSheetOpen(false)}
          />
          <AbonementTopupFlow
            plans={[]}
            timezoneEndpoint="/api/operator/tenant-timezone"
            searchEndpoint="/api/operator/abonements"
            createEndpoint="/api/operator/abonements"
            topupEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/topup`}
            allowZoneSpend
            spendZones={spendZones}
            zoneSpendEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/zone-spend`}
            spendOnlyMode
            toastErrors
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 md:max-w-xl lg:max-w-2xl">
        <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.zonesList.accountingModeCounters}</h1>

        {/* Тапы-показания (запрос пользователя 2026-07-25) — только зоны с
            включённым Zone.countersTapAssistEnabled, тот же тайл-паттерн, что
            у "Пусков" — дропдаун зон при их больше одной (запрос
            пользователя того же дня: "зоны должны выбираться dropdown").
            Стоит выше кнопок "Списать с баланса"/"Возврат/тест" (запрос
            пользователя 2026-07-26) — это основное, наиболее частое действие
            на этом экране. */}
        {allTapAssets.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption-airbnb font-semibold text-muted-foreground">{t.operatorApp.counters.tapTitle}</p>
              {/* "Возврат/тест" для tap-зон (запрос пользователя 2026-07-25) —
                  привязка к конкретному тапу вместо зонного счётчика, см.
                  комментарий у recentTaps выше. */}
              {recentTaps.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="gap-1.5 rounded-lg"
                  onClick={() => setTapHistoryOpen(true)}
                >
                  <History className="size-3.5" />
                  {t.operatorApp.counters.tapHistoryButton}
                </Button>
              )}
            </div>
            {tapZones.length > 1 && (
              <div className="flex items-center gap-2">
                <Label className="shrink-0">{t.operatorApp.tally.zoneFilterLabel}</Label>
                <div className="min-w-0 flex-1">
                  <Select
                    value={tapZoneFilter}
                    onValueChange={(v) => {
                      if (!v) return;
                      setTapZoneFilter(v);
                      window.localStorage.setItem(TAP_ZONE_FILTER_KEY, v);
                    }}
                    items={[
                      { value: TAP_ALL_ZONES, label: t.operatorApp.tally.allZonesOption },
                      ...tapZones.map((z) => ({ value: z.id, label: z.name })),
                    ]}
                  >
                    <SelectTrigger className="h-11 w-full bg-muted">
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          {tapFilterZone ? (
                            tapFilterZone.iconKey ? (
                              <AssetOrZoneIcon iconKey={tapFilterZone.iconKey} className="size-5 shrink-0" />
                            ) : (
                              <MapPin className="size-5 shrink-0 text-muted-foreground" />
                            )
                          ) : (
                            <Layers className="size-5 shrink-0 text-muted-foreground" />
                          )}
                          {tapFilterZone ? tapFilterZone.name : t.operatorApp.tally.allZonesOption}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TAP_ALL_ZONES}>
                        <span className="flex items-center gap-2">
                          <Layers className="size-5 shrink-0 text-muted-foreground" />
                          {t.operatorApp.tally.allZonesOption}
                        </span>
                      </SelectItem>
                      {tapZones.map((z) => (
                        <SelectItem key={z.id} value={z.id}>
                          <span className="flex items-center gap-2">
                            {z.iconKey ? (
                              <AssetOrZoneIcon iconKey={z.iconKey} className="size-5 shrink-0" />
                            ) : (
                              <MapPin className="size-5 shrink-0 text-muted-foreground" />
                            )}
                            {z.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {/* Минимум 3 тайла в ряд даже на узких экранах (запрос
                пользователя 2026-07-26) — обычный auto-fill/minmax(8rem)
                тут даёт только 2 на телефоне, поэтому фиксированные
                брейкпоинты вместо auto-fill. */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3" onPointerDownCapture={() => unlockBeep()}>
              {filteredTapAssets.map((a) => {
                const count = tapCountForAsset(a.id);
                return (
                  <PressableScale key={a.id}>
                    <button
                      type="button"
                      onClick={() => handleTapTileTap(a)}
                      disabled={!a.active || tapSubmitting}
                      className="flex w-full flex-col overflow-hidden rounded-card border-[1.5px] border-border bg-card text-left disabled:opacity-40"
                    >
                      <div className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden bg-muted">
                        {a.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.photoUrl} alt="" className="size-full object-contain object-center" />
                        ) : a.iconKey ? (
                          <AssetOrZoneIcon iconKey={a.iconKey} className="size-10 text-muted-foreground" />
                        ) : (
                          <MapPin className="size-9 text-muted-foreground" />
                        )}
                        <span
                          className="absolute left-2.5 top-2.5 size-4 rounded-full ring-[2.5px] ring-card"
                          style={{ backgroundColor: a.colorTag }}
                        />
                        {count > 0 && (
                          <span className="absolute right-2 top-2 flex min-w-11 items-center justify-center rounded-full bg-primary px-2.5 py-1.5 text-2xl font-extrabold tabular-nums text-primary-foreground shadow-md ring-2 ring-card">
                            {count}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 p-3">
                        <span className="truncate text-[0.90625rem] font-bold tracking-[-0.01em]">{a.name}</span>
                        {tapZoneFilter === TAP_ALL_ZONES && tapZones.length > 1 && (
                          <span className="truncate text-[0.75rem] text-muted-foreground">{a.zoneName}</span>
                        )}
                      </div>
                    </button>
                  </PressableScale>
                );
              })}
            </div>
          </div>
        )}

        {/* "Списать с баланса" — тот же стиль/размер, что у "Сдача итогов" на
            Главной (запрос пользователя 2026-07-24), это главное действие
            здесь; "Возврат/тест" — уже, второстепенное действие рядом. */}
        <div className="flex gap-3">
          <PressableScale className="flex-1">
            <Button
              type="button"
              disabled={!spendZones || spendZones.length === 0}
              onClick={() => setSpendSheetOpen(true)}
              className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-control p-2 text-center text-base font-bold"
            >
              <Wallet className="size-7" />
              <span className="leading-tight">{t.operatorApp.abonement.spendTitle}</span>
            </Button>
          </PressableScale>
          {/* Только зоны БЕЗ тапов (запрос пользователя 2026-07-25) — у
              tap-зон "Возврат/тест" теперь отдельная механика выше, привязанная
              к конкретному тапу, а не к зоне целиком (см. "История тапов"). */}
          {zones.length > 0 && (
          <PressableScale className="relative w-36 shrink-0">
            <button
              type="button"
              onClick={openReturnSheet}
              className="relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-control border-[1.5px] border-border bg-card p-2 text-center"
            >
              {events.length > 0 && (
                <span className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-muted text-lg font-extrabold tabular-nums text-muted-foreground shadow-md">
                  {events.length}
                </span>
              )}
              <RefreshCcw className="size-6 text-muted-foreground" />
              {/* Реальный баг, найден пользователем 2026-07-25 на скриншоте —
                  текст переносился на 2 строки при узкой кнопке (w-28); шире
                  кнопка + whitespace-nowrap держат подпись в одну строку. */}
              <span className="text-xs leading-snug font-bold whitespace-nowrap">{t.operatorApp.submit.returnsCardLabel}</span>
            </button>
          </PressableScale>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-caption-airbnb font-semibold text-muted-foreground">{t.operatorApp.counters.logTitle}</p>
          {events.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.counters.emptyLog}</p>
          ) : (
            <StaggerList className="flex flex-col gap-2.5">
              {events.map((e) => (
                <StaggerItem key={e.id}>
                  <SpringCard animate={false} className="!p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
                        <RefreshCcw className="size-4" />
                      </div>
                      <div className="min-w-0 grow">
                        <div className="truncate text-body-airbnb font-semibold">{e.zoneName}</div>
                        <p className="text-caption-airbnb text-muted-foreground">{formatTime(e.createdAt)}</p>
                      </div>
                      <IconActionButton icon={Trash2} onClick={() => deleteEvent(e.id)} label={t.common.delete} destructive />
                    </div>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={returnSheetOpen} onClose={() => setReturnSheetOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          {zones.length > 1 && !returnZone && (
            <>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.counters.pickZoneTitle}</h2>
              {/* Тап сразу переключает на следующий экран (returnZone
                  устанавливается и этот блок размонтируется), поэтому
                  "выбранного" состояния тут никогда не бывает видно — только
                  сама сетка/стиль тайла общий со "Сдачей итогов"/"Расходами". */}
              <div className="grid grid-cols-3 gap-3">
                {zones.map((zone) => (
                  <PressableScale key={zone.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setReturnZone(zone)}
                      className="relative flex w-full flex-col items-center gap-2.5 rounded-card border-[1.5px] border-border bg-card px-3 py-5 text-center"
                    >
                      <div className="flex size-14 items-center justify-center rounded-control bg-muted text-muted-foreground/50">
                        {zone.iconKey ? <AssetOrZoneIcon iconKey={zone.iconKey} className="size-9" /> : <MapPin className="size-9" />}
                      </div>
                      <span className="text-[0.90625rem] font-semibold text-foreground">{zone.name}</span>
                    </button>
                  </PressableScale>
                ))}
              </div>
            </>
          )}
          {(returnZone || zones.length === 1) && (
            <>
              {zones.length > 1 && <BackLink label={t.common.back} onClick={() => setReturnZone(null)} />}
              <div className="flex flex-col items-center gap-4 py-2 text-center">
                <p className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{(returnZone ?? zones[0]).name}</p>
                <p className="text-body-airbnb text-muted-foreground">
                  {t.operatorApp.counters.todayCountLabel} <span className="font-bold text-foreground">{countFor((returnZone ?? zones[0]).id)}</span>
                </p>
                <PressableScale className="w-full">
                  <SaveButton
                    type="button"
                    className="h-14 w-full text-lg font-bold"
                    disabled={logging}
                    saved={returnSaved}
                    onClick={() => logReturn(returnZone ?? zones[0])}
                  />
                </PressableScale>
              </div>
            </>
          )}
        </div>
      </BottomSheet>

      {/* Тап-показание (запрос пользователя 2026-07-25) — тариф (если их два)
          → способ оплаты, обязательно с подтверждением "Точно?" (та же
          логика/компонент ConfirmButton, что у "Пусков" — "надо
          подтверждение, как и в Пусках"). Наличные/Безнал — справочная
          пометка (НЕ подставляется в кассу зоны на Сдаче итогов, сверка факта
          с расчётом должна остаться реальной проверкой); Баланс — реальное
          списание через AbonementPaymentSheet ниже. */}
      <BottomSheet open={tapFlow !== null} onClose={() => setTapFlow(null)}>
        {tapFlow &&
          !tapFlow.tariffId &&
          (() => {
            const zone = tapZones.find((z) => z.id === tapFlow.zoneId);
            if (!zone) return null;
            return (
              <div className="flex flex-col gap-3 pt-2">
                <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.pickOptionTitle}</h2>
                <div className="flex flex-col gap-2">
                  {zone.tariffs.map((tf) => (
                    <PressableScale key={tf.id}>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-12 w-full justify-between font-semibold"
                        disabled={tapSubmitting}
                        onClick={() => setTapFlow({ zoneId: zone.id, assetId: tapFlow.assetId, tariffId: tf.id })}
                      >
                        <span>{tf.name}</span>
                        <span className="text-caption-airbnb text-muted-foreground tabular-nums">
                          {t.operatorApp.counters.todayCountLabel} {tapCountFor(tapFlow.assetId, tf.id)}
                        </span>
                      </Button>
                    </PressableScale>
                  ))}
                </div>
              </div>
            );
          })()}
        {tapFlow?.tariffId &&
          (() => {
            const zone = tapZones.find((z) => z.id === tapFlow.zoneId);
            const asset = allTapAssets.find((a) => a.id === tapFlow.assetId);
            const tariff = zone?.tariffs.find((tf) => tf.id === tapFlow.tariffId);
            if (!zone || !asset || !tariff) return null;
            return (
              <div className="flex flex-col gap-3 pt-2">
                <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.paymentMethodTitle}</h2>
                <p className="text-caption-airbnb text-muted-foreground">
                  {asset.name} · {tariff.name} · <Money value={tariff.price} />
                </p>
                <div className="flex flex-col gap-2">
                  <ConfirmButton
                    className="relative h-12 w-full font-semibold"
                    disabled={tapSubmitting}
                    silent
                    onConfirm={() => logCounterTap(zone.id, tapFlow.assetId, tapFlow.tariffId!, "cash")}
                  >
                    <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                    {t.operatorApp.submit.cashLabel}
                  </ConfirmButton>
                  <ConfirmButton
                    className="relative h-12 w-full font-semibold"
                    disabled={tapSubmitting}
                    silent
                    onConfirm={() => logCounterTap(zone.id, tapFlow.assetId, tapFlow.tariffId!, "mobile")}
                  >
                    <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                    {t.operatorApp.submit.mobileLabel}
                  </ConfirmButton>
                  {clientsEnabled && (
                    <PressableScale>
                      <Button
                        type="button"
                        variant="outline"
                        className="relative h-12 w-full font-semibold"
                        disabled={tapSubmitting}
                        onClick={() => {
                          const target = { zoneId: zone.id, assetId: tapFlow.assetId, tariffId: tapFlow.tariffId!, amount: tariff.price };
                          setTapFlow(null);
                          setAbonementTarget(target);
                        }}
                      >
                        <Wallet className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                        {t.operatorApp.abonement.paymentLabel}
                      </Button>
                    </PressableScale>
                  )}
                </div>
                <PressableScale className="w-fit">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto gap-1 px-0 text-muted-foreground underline underline-offset-2"
                    onClick={() => {
                      setSplitTapTarget({ zoneId: zone.id, assetId: tapFlow.assetId, tariffId: tapFlow.tariffId!, amount: tariff.price });
                      setTapFlow(null);
                    }}
                  >
                    <ArrowLeftRight className="size-3.5" />
                    {t.splitPayment.title}
                  </Button>
                </PressableScale>
              </div>
            );
          })()}
      </BottomSheet>

      <AbonementPaymentSheet
        open={abonementTarget !== null}
        onClose={() => setAbonementTarget(null)}
        amount={abonementTarget?.amount ?? 0}
        silent
        onConfirm={(walletId) => {
          if (!abonementTarget) return undefined;
          return logCounterTap(abonementTarget.zoneId, abonementTarget.assetId, abonementTarget.tariffId, "abonement", walletId);
        }}
      />

      <SplitPaymentSheet
        open={splitTapTarget !== null}
        onClose={() => setSplitTapTarget(null)}
        total={splitTapTarget?.amount ?? 0}
        allowedMethods={TAP_SPLIT_METHODS}
        clientsEnabled={clientsEnabled}
        submitting={tapSubmitting}
        onSubmit={(legs) =>
          splitTapTarget
            ? logCounterTap(splitTapTarget.zoneId, splitTapTarget.assetId, splitTapTarget.tariffId, undefined, undefined, legs)
            : undefined
        }
      />

      {/* История тапов текущего периода (запрос пользователя 2026-07-25) —
          "Возврат/тест" тут ставится на КОНКРЕТНЫЙ тап, а не на зону целиком
          (см. комментарий у recentTaps выше); заодно тут же можно отменить
          случайный тап целиком (та же логика, что у "Возвратов" — опечатка в
          моменте, не ретроактивная правка). */}
      <BottomSheet open={tapHistoryOpen} onClose={() => setTapHistoryOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.counters.tapHistoryButton}</h2>
          {recentTaps.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.counters.emptyLog}</p>
          ) : (
            <div className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto">
              {recentTaps.map((tap) => (
                <SpringCard key={tap.id} animate={false} className="!p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
                      {tap.paymentMethod ? <PaymentMethodIcon method={tap.paymentMethod} /> : <History className="size-4" />}
                    </div>
                    <div className="min-w-0 grow">
                      <div className="truncate text-body-airbnb font-semibold">
                        {tap.assetName} · {tap.tariffName}
                      </div>
                      <p className="text-caption-airbnb text-muted-foreground">
                        {formatTime(tap.createdAt)}
                        {tap.voidedAt && ` · ${t.operatorApp.counters.tapVoidedLabel}`}
                      </p>
                    </div>
                    <IconActionButton
                      icon={Undo2}
                      onClick={() => toggleTapVoid(tap)}
                      label={tap.voidedAt ? t.operatorApp.counters.tapUnvoidAction : t.operatorApp.counters.tapVoidAction}
                      destructive={!tap.voidedAt}
                    />
                    <IconActionButton icon={Trash2} onClick={() => deleteTap(tap.id)} label={t.common.delete} destructive />
                  </div>
                </SpringCard>
              ))}
            </div>
          )}
        </div>
      </BottomSheet>

      <ActionToast message={tapErrorToast.message} variant={tapErrorToast.variant} />
    </div>
  );
}
