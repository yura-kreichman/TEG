"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Banknote, Check, CreditCard, MapPin, Layers, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { PrintButton } from "@/components/print/print-button";
import { isLaunchesZone } from "@/lib/results-calc";
import { useLiveNow } from "@/hooks/use-live-now";
import { formatMMSS } from "@/lib/game-room-client";
import { unlockBeep, playBeep, playConfirmChime, playCloseChime, playErrorChime } from "@/lib/beep";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { SplitPaymentSheet } from "@/components/split-payment-sheet";
import type { PaymentLegInput } from "@/lib/payment-split";
import { ActionToast } from "@/components/action-toast";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import { useActionToast } from "@/hooks/use-action-toast";
import { useLiveRefetch } from "@/hooks/use-live-refetch";
import type { PrintDocumentData } from "@/lib/print/receipt-document";
import { formatMoneyWithCurrency } from "@/lib/format";
import { cn, colorTagGradient } from "@/lib/utils";

interface TariffOptionCtx {
  id: string;
  name: string | null;
  durationMinutes: number;
  price: number;
}

interface TariffCtx {
  id: string;
  name: string;
  price: number;
  // Только "fixed" — тариф с таймером (запрос пользователя 2026-07-28: "10
  // руб. за 10 минут, 15 руб. за 20 минут"), null у обычного мгновенного
  // тарифа (текущее поведение без изменений).
  pricingMode: "fixed" | null;
  options: TariffOptionCtx[];
}

// Открытый (таймерный) пуск — та же механика "За вход" у "Прибываний", но
// на актив держится не больше одного разом (машинка одна, катает одного
// ребёнка за раз), поэтому тайл, а не список браслетов.
interface OpenLaunch {
  id: string;
  assetId: string;
  tariffId: string;
  startedAt: string;
  priceSnapshot: number;
  durationMinutesSnapshot: number;
}

interface AssetCtx {
  id: string;
  name: string;
  iconKey: string | null;
  photoUrl: string | null;
  colorTag: string;
  active: boolean;
}

interface AssetWithZone extends AssetCtx {
  zoneId: string;
  zoneName: string;
}

interface ZoneCtx {
  id: string;
  name: string;
  iconKey: string | null;
  assets: AssetCtx[];
  tariffs: TariffCtx[];
  printReceiptEnabled: boolean;
}

interface TallyEntry {
  assetId: string;
  tariffId: string;
  count: number;
  amount: number;
}

const POLL_MS = 6000;
const ALL_ZONES = "all";
const ZONE_FILTER_KEY = "launchesZoneFilter";
const TALLY_SPLIT_METHODS = ["cash", "mobile", "abonement"] as const;

/**
 * Экран "Пуски" в PWA оператора (docs/spec/04-game-room.md, режим
 * "launches") — точка входа из нижнего бара напрямую сюда, без
 * промежуточного списка зон (запрос пользователя 2026-07-17: "открываются
 * все активы с dropdown фильтром по зонам", тот же принцип, что и у
 * "Прибываний"). Тайлы активов ВСЕХ зон режима "launches" разом, dropdown
 * сверху сужает до одной зоны. Тап мгновенно учитывает один пуск (нет
 * браслетов, нет старта/стопа во времени) — цифровая замена бумажной
 * тетрадки с плюсиками.
 */
export default function LaunchesZonePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();
  const printAvailable = useOperatorPrintAvailable();
  const now = useLiveNow();

  const [zones, setZones] = useState<ZoneCtx[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string>(ALL_ZONES);
  const [entries, setEntries] = useState<TallyEntry[]>([]);
  // Открытые (таймерные) пуски всех зон "Пусков" разом (запрос пользователя
  // 2026-07-28) — не больше одного на актив, тайл заменяет свой обычный вид
  // на живой отсчёт, пока пуск открыт.
  const [openLaunches, setOpenLaunches] = useState<OpenLaunch[]>([]);
  const [loading, setLoading] = useState(true);
  const errorToast = useActionToast();
  function flashError(message: string) {
    playErrorChime();
    errorToast.flash(message, "error");
  }
  const [submitting, setSubmitting] = useState(false);
  // "Точно?" — инлайн в тайле при досрочной остановке (запрос пользователя
  // 2026-07-28, тот же приём, что у "Прибываний"); после истечения времени
  // тап освобождает актив сразу, без вопроса (см. releaseLaunch ниже).
  const [interacting, setInteracting] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const alertedRef = useRef<Set<string>>(new Set());
  // Модуль печати (запрос пользователя 2026-07-20) — квитанция пуска, кнопка
  // появляется сразу после тапа, только если в зоне включено
  // printReceiptEnabled (та же логика, что у "Прибываний").
  const [lastTap, setLastTap] = useState<{
    zoneName: string;
    assetName: string;
    tariffName: string;
    amount: number;
    paymentMethod: "cash" | "mobile" | "abonement" | "split";
    legs?: PaymentLegInput[];
  } | null>(
    null
  );

  // Тап по активу — если тарифов у его зоны больше одного, сперва выбор
  // тарифа; если выбранный тариф таймерный ("fixed" с вариантами, запрос
  // пользователя 2026-07-28) — следом выбор варианта длительности; затем
  // способ оплаты. С одним тарифом без вариантов шаг выбора тарифа
  // пропускается (tariffId проставляется сразу), см. handleTileTap. zoneId
  // нужен явно — активы разных зон смешаны в одном гриде.
  const [tapFlow, setTapFlow] = useState<{ zoneId: string; assetId: string; tariffId?: string; optionId?: string } | null>(
    null
  );

  // Оплата абонементом (запрос пользователя 2026-07-17) — третий способ
  // наравне с наличными/безналом, открывается ПОВЕРХ tapFlow (закрывается в
  // момент тапа "Абонемент"), amount — цена выбранного тарифа.
  const [abonementTarget, setAbonementTarget] = useState<
    { zoneId: string; assetId: string; tariffId: string; optionId?: string; amount: number } | null
  >(null);
  // Настройки → Система → "Модули" (запрос пользователя 2026-07-22) —
  // кнопка "Баланс" прячется целиком, если Владелец отключил Клиентов;
  // серверная защита уже есть в /api/zones/[id]/tally.
  const [clientsEnabled, setClientsEnabled] = useState(true);
  // Разбивка оплаты (аудит 2026-07-26) — тот же приём захвата цели в момент
  // клика, что у splitStartTarget в game-room/page.tsx: tapFlow обнуляется
  // до открытия SplitPaymentSheet.
  const [splitTapTarget, setSplitTapTarget] = useState<
    { zoneId: string; assetId: string; tariffId: string; optionId?: string; amount: number } | null
  >(null);

  function loadZones() {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          router.replace("/operator/login");
          return;
        }
        const launches: ZoneCtx[] = (data.zones ?? [])
          .filter(isLaunchesZone)
          .map(
            (z: {
              id: string;
              name: string;
              iconKey: string | null;
              assets: AssetCtx[];
              tariffs: TariffCtx[];
              printReceiptEnabled: boolean;
            }) => ({
              id: z.id,
              name: z.name,
              iconKey: z.iconKey,
              assets: z.assets ?? [],
              tariffs: z.tariffs ?? [],
              printReceiptEnabled: z.printReceiptEnabled,
            })
          );
        if (launches.length === 0) {
          router.replace("/operator");
          return;
        }
        setZones(launches);
        setClientsEnabled(data.clientsEnabled !== false);
        // Переход из глобального баннера "истекает таймер" ведёт сразу к
        // зоне просроченного актива (запрос пользователя 2026-07-28, тот же
        // приём, что у "Прибываний") — сужаем dropdown, сам тайл актива и
        // так виден в общей сетке зоны.
        const requestedAssetId = searchParams.get("assetId");
        const requestedAsset = requestedAssetId
          ? launches.flatMap((z) => z.assets.map((a) => ({ ...a, zoneId: z.id }))).find((a) => a.id === requestedAssetId)
          : null;
        if (requestedAsset) {
          setZoneFilter(requestedAsset.zoneId);
        } else {
          // Запоминаем последний выбор фильтра зоны (запрос пользователя
          // 2026-07-18: "должен запоминаться статус выбранной Зоны, а не
          // быть по умолчанию Все зоны при открытии") — тот же приём, что у
          // "Прибываний" (game-room/page.tsx).
          const savedZoneFilter = window.localStorage.getItem(ZONE_FILTER_KEY);
          if (savedZoneFilter && launches.some((z) => z.id === savedZoneFilter)) {
            setZoneFilter(savedZoneFilter);
          }
        }
        setLoading(false);
      });
  }

  function loadTallies(zoneList: ZoneCtx[]) {
    Promise.all(
      zoneList.map((z) => fetch(`/api/zones/${z.id}/tally`).then((res) => (res.ok ? res.json() : null)))
    ).then((results) => {
      const merged: TallyEntry[] = [];
      const mergedOpen: OpenLaunch[] = [];
      for (const data of results) {
        if (data?.entries) merged.push(...data.entries);
        if (data?.openLaunches) mergedOpen.push(...data.openLaunches);
      }
      setEntries(merged);
      setOpenLaunches(mergedOpen);
    });
  }

  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Держит список зон/активов/тарифов свежим, пока экран часами не покидают
  // (запрос пользователя 2026-07-22).
  useLiveRefetch(loadZones);

  useEffect(() => {
    if (zones.length === 0) return;
    loadTallies(zones);
    const interval = setInterval(() => loadTallies(zones), POLL_MS);
    return () => clearInterval(interval);
  }, [zones]);

  const allAssets: AssetWithZone[] = useMemo(
    () => zones.flatMap((z) => z.assets.map((a) => ({ ...a, zoneId: z.id, zoneName: z.name }))),
    [zones]
  );
  const filteredAssets = zoneFilter === ALL_ZONES ? allAssets : allAssets.filter((a) => a.zoneId === zoneFilter);

  const countByAsset = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.assetId, (map.get(e.assetId) ?? 0) + e.count);
    return map;
  }, [entries]);

  const openLaunchByAsset = useMemo(() => {
    const map = new Map<string, OpenLaunch>();
    for (const l of openLaunches) map.set(l.assetId, l);
    return map;
  }, [openLaunches]);

  function handleTileTap(asset: AssetWithZone) {
    if (!asset.active || submitting) return;
    const zone = zones.find((z) => z.id === asset.zoneId);
    if (!zone || zone.tariffs.length === 0) {
      flashError(t.operatorApp.gameRoom.noPricingError);
      return;
    }
    setTapFlow(
      zone.tariffs.length === 1
        ? { zoneId: zone.id, assetId: asset.id, tariffId: zone.tariffs[0].id }
        : { zoneId: zone.id, assetId: asset.id }
    );
  }

  async function logTap(
    zoneId: string,
    assetId: string,
    tariffId: string,
    paymentMethod: "cash" | "mobile" | "abonement",
    abonementWalletId?: string,
    legs?: PaymentLegInput[],
    optionId?: string
  ) {
    setSubmitting(true);
    const zone = zones.find((z) => z.id === zoneId);
    const asset = allAssets.find((a) => a.id === assetId);
    const tariff = zone?.tariffs.find((tf) => tf.id === tariffId);
    try {
      const res = await fetch(`/api/zones/${zoneId}/tally`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, tariffId, optionId, paymentMethod, abonementWalletId, legs }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      // Звук подтверждения (запрос пользователя 2026-07-20) — "бам-бум",
      // сразу после успешного тапа+оплаты, независимо от печати/тумблеров.
      playConfirmChime();
      setTapFlow(null);
      setAbonementTarget(null);
      setSplitTapTarget(null);
      if (data.isOpen) {
        // Таймерный пуск (запрос пользователя 2026-07-28) — тайл сразу
        // переключается на живой отсчёт, не дожидаясь опроса (POLL_MS).
        setOpenLaunches((prev) => [
          ...prev,
          {
            id: data.id,
            assetId: data.assetId,
            tariffId: data.tariffId,
            startedAt: data.startedAt,
            priceSnapshot: data.priceSnapshot,
            durationMinutesSnapshot: data.durationMinutesSnapshot,
          },
        ]);
      } else {
        loadTallies(zones);
      }
      if (zone && asset && tariff && zone.printReceiptEnabled && printAvailable.available) {
        setLastTap({
          zoneName: zone.name,
          assetName: asset.name,
          tariffName: tariff.name,
          // data.amount (реально начисленное на сервере), не tariff.price
          // (аудит 2026-07-27, второй раунд, реальный денежный баг) —
          // tariff.price читался из локального state зон, который обновляется
          // только polling'ом/фокусом (useLiveRefetch, ~25с). Если владелец
          // поменял цену тарифа в Настройках между двумя обновлениями этого
          // экрана, оператор видел в подтверждении/на чеке СТАРУЮ цену, хотя
          // сервер уже посчитал и записал НОВУЮ — расхождение между тем, что
          // реально списано, и тем, что показано/распечатано. У таймерного
          // пуска amount ещё null (закроется позже) — на чеке показываем
          // priceSnapshot, ту же сумму, что уже реально списана при старте.
          amount: Number(data.amount ?? data.priceSnapshot),
          paymentMethod: legs ? "split" : paymentMethod,
          legs: legs && legs.length > 0 ? legs : undefined,
        });
      }
    } catch {
      // Сетевая ошибка — пуск на сервере не создан (тот же принцип, что и у
      // "Прибываний"), повтор безопасен.
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  // Стоп таймерного пуска — досрочно (после инлайн "Точно?") или сразу после
  // истечения (запрос пользователя 2026-07-28: "тапом Сотрудник освобождает
  // его для следующего Пуска"). Способ оплаты уже известен и сохранён при
  // старте (pricingMode всегда "fixed" у "Пусков") — /api/launches/[id]/stop
  // не спрашивает его заново для этого режима, закрывает сразу.
  async function releaseLaunch(launchId: string) {
    if (stopping) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/launches/${launchId}/stop`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      playCloseChime();
      setInteracting(null);
      setOpenLaunches((prev) => prev.filter((l) => l.id !== launchId));
      loadTallies(zones);
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStopping(false);
    }
  }

  function isLaunchExpired(l: OpenLaunch): boolean {
    const expiresAt = new Date(l.startedAt).getTime() + l.durationMinutesSnapshot * 60000;
    return now.getTime() >= expiresAt;
  }

  // Сигнал истечения (docs/spec/04-game-room.md, та же механика у "Пусков" —
  // запрос пользователя 2026-07-28) — разово на каждый пуск.
  useEffect(() => {
    for (const l of openLaunches) {
      const expiresAt = new Date(l.startedAt).getTime() + l.durationMinutesSnapshot * 60000;
      if (now.getTime() >= expiresAt && !alertedRef.current.has(l.id)) {
        alertedRef.current.add(l.id);
        playBeep();
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
      }
    }
  }, [openLaunches, now]);

  const tapPaymentMethodLabel: Record<string, string> = {
    cash: t.operatorApp.submit.cashLabel,
    mobile: t.operatorApp.submit.mobileLabel,
    abonement: t.reports.abonementLabel,
  };

  // Квитанция пуска (модуль печати, запрос пользователя 2026-07-20) —
  // печать по требованию, сразу после тапа.
  function buildTapReceiptData(s: NonNullable<typeof lastTap>): PrintDocumentData {
    return {
      title: t.operatorApp.tally.receiptTitle,
      subtitle: `${s.zoneName} · ${new Date().toLocaleString(locale)}${printAvailable.operatorName ? ` · ${printAvailable.operatorName}` : ""}`,
      sections: [
        {
          lines: [
            // Значения в строке позиции не показываем — позиция всегда ровно
            // одна за документ (не настоящий список из разных позиций, как
            // Z-отчёт по зонам), сумма и так видна ниже в "Сумма";
            // дублирование только путало (запрос пользователя 2026-07-20).
            { label: `${s.assetName} · ${s.tariffName}`, value: "", large: true },
            // Разбивка оплаты (аудит 2026-07-26) — своя строка на каждый
            // способ вместо одной общей, тот же приём, что у "Прибываний".
            ...(s.legs
              ? s.legs.map((leg) => ({
                  label: tapPaymentMethodLabel[leg.method] ?? leg.method,
                  value: formatMoneyWithCurrency(leg.amount, locale, currency),
                }))
              : [{ label: t.operatorApp.gameRoom.receiptPaymentMethodLabel, value: tapPaymentMethodLabel[s.paymentMethod] }]),
          ],
        },
      ],
      totalLine: {
        label: t.operatorApp.gameRoom.receiptAmountLabel,
        value: formatMoneyWithCurrency(s.amount, locale, currency),
      },
    };
  }

  if (loading) return null;

  const filterZone = zones.find((z) => z.id === zoneFilter) ?? null;
  const tapZone = tapFlow ? (zones.find((z) => z.id === tapFlow.zoneId) ?? null) : null;
  const tapAsset = tapFlow ? (allAssets.find((a) => a.id === tapFlow.assetId) ?? null) : null;
  const tapTariff = tapFlow?.tariffId ? (tapZone?.tariffs.find((tf) => tf.id === tapFlow.tariffId) ?? null) : null;
  // Таймерный тариф (pricingMode="fixed") — нужен ещё шаг выбора варианта
  // длительности между тарифом и способом оплаты (запрос пользователя
  // 2026-07-28).
  const tapIsTimed = tapTariff?.pricingMode === "fixed";
  const tapOption =
    tapIsTimed && tapFlow?.optionId ? (tapTariff?.options.find((o) => o.id === tapFlow.optionId) ?? null) : null;
  const tapPrice = tapIsTimed ? (tapOption?.price ?? null) : (tapTariff?.price ?? null);

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6" onPointerDownCapture={() => unlockBeep()}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-xl lg:max-w-2xl">
        <h1 className="mb-4 text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.tally.entryTitle}</h1>

        {zones.length > 1 && (
          <div className="mb-4 flex items-center gap-2">
            <Label className="shrink-0">{t.operatorApp.tally.zoneFilterLabel}</Label>
            <div className="min-w-0 flex-1">
              <Select
                value={zoneFilter}
                onValueChange={(v) => {
                  if (!v) return;
                  setZoneFilter(v);
                  window.localStorage.setItem(ZONE_FILTER_KEY, v);
                }}
                items={[
                  { value: ALL_ZONES, label: t.operatorApp.tally.allZonesOption },
                  ...zones.map((z) => ({ value: z.id, label: z.name })),
                ]}
              >
                <SelectTrigger className="h-11 w-full bg-muted">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {filterZone ? (
                        filterZone.iconKey ? (
                          <AssetOrZoneIcon iconKey={filterZone.iconKey} className="size-5 shrink-0" />
                        ) : (
                          <MapPin className="size-5 shrink-0 text-muted-foreground" />
                        )
                      ) : (
                        <Layers className="size-5 shrink-0 text-muted-foreground" />
                      )}
                      {filterZone ? filterZone.name : t.operatorApp.tally.allZonesOption}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONES}>
                    <span className="flex items-center gap-2">
                      <Layers className="size-5 shrink-0 text-muted-foreground" />
                      {t.operatorApp.tally.allZonesOption}
                    </span>
                  </SelectItem>
                  {zones.map((z) => (
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

        {filteredAssets.length === 0 ? (
          <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.operatorApp.gameRoom.noAssetsYet}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
            {filteredAssets.map((a) => {
              const count = countByAsset.get(a.id) ?? 0;
              const openLaunch = openLaunchByAsset.get(a.id);
              const expired = openLaunch ? isLaunchExpired(openLaunch) : false;
              const remainingMs = openLaunch
                ? new Date(openLaunch.startedAt).getTime() + openLaunch.durationMinutesSnapshot * 60000 - now.getTime()
                : 0;
              const interactingHere = openLaunch !== undefined && interacting === openLaunch.id;
              // Последние 30 секунд до истечения — тайл тоже начинает
              // мигать, не только после самого истечения (запрос
              // пользователя 2026-07-28: "когда время приближается, он
              // должен тоже немного мигать").
              const nearExpiry = openLaunch !== undefined && !expired && remainingMs <= 30000;

              // "Точно?" — на весь тайл, тот же приём, что у "Прибываний"
              // при досрочной остановке (запрос пользователя 2026-07-28: "не
              // в строке названия актива, а как везде на весь тайл").
              if (interactingHere && openLaunch) {
                return (
                  <div
                    key={a.id}
                    className="flex h-35 w-full flex-col items-center justify-center gap-2 rounded-card border-[1.5px] border-primary bg-card p-2 text-center shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]"
                  >
                    <span className="truncate text-[0.8125rem] font-bold">{a.name}</span>
                    <span className="text-[0.6875rem] font-semibold">{t.operatorApp.gameRoom.stopConfirmQuestion}</span>
                    <div className="flex items-center gap-2">
                      <PressableScale>
                        <button
                          type="button"
                          aria-label={t.common.close}
                          onClick={() => setInteracting(null)}
                          className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
                        >
                          <X className="size-4" />
                        </button>
                      </PressableScale>
                      <PressableScale>
                        <button
                          type="button"
                          aria-label={t.operatorApp.gameRoom.stopConfirmButton}
                          disabled={stopping}
                          onClick={() => releaseLaunch(openLaunch.id)}
                          className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
                        >
                          <Check className="size-4" />
                        </button>
                      </PressableScale>
                    </div>
                  </div>
                );
              }

              // Фото/иконка актива — общий блок для всех состояний тайла
              // (запрос пользователя 2026-07-28: "'Время вышло' неудобно,
              // так как не видно фото актива — уберём фразу совсем, пусть
              // таймер немного bounce делает с 00:00") — меняется только
              // правый верхний бейдж (счётчик пусков / живой отсчёт /
              // 00:00) и цвет рамки.
              const header = (
                <div className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden rounded-t-card bg-muted">
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
                </div>
              );

              // Бейдж (таймер/счётчик) — на самом углу актива, как и другие
              // бейджи-подсказки в проекте (запрос пользователя 2026-07-28:
              // "пусть начинается с угла актива как у нас всякие галочки,
              // количества"), т.е. поверх границы тайла (-right-2 -top-2), а
              // не внутри фото-области — вынесен за пределы header/button
              // (у обоих overflow-hidden обрезал бы его). Таймер — чуть
              // крупнее прежнего (запрос того же дня).
              const badge = openLaunch ? (
                <span
                  className={cn(
                    "absolute -right-2 -top-2 z-10 flex min-w-12 items-center justify-center rounded-full px-3 py-2 text-lg font-extrabold tabular-nums shadow-md",
                    expired || nearExpiry
                      ? "bg-destructive text-white motion-safe:animate-pulse"
                      : // Идущий отсчёт — светлее сплошной заливки счётчика
                        // пусков, но НЕ прозрачный (запрос пользователя
                        // 2026-07-28: "таймер не должен быть прозрачным" —
                        // bg-primary/NN просвечивал бы фото под собой).
                        // Сплошной светлый тон через color-mix с --card
                        // (тот же приём, что --nav-glass-bg-solid в
                        // globals.css) — не hex, настоящий акцент тенанта.
                        "bg-[color-mix(in_oklab,var(--primary)_35%,var(--card))] text-primary"
                  )}
                >
                  {formatMMSS(Math.max(0, remainingMs))}
                </span>
              ) : (
                // Счётчик пусков — значительно крупнее прежнего (запрос
                // пользователя 2026-07-17: "количество пусков надо сделать
                // значительно крупнее"), главное число на тайле, вместо
                // мелкого бейджа-подсказки.
                count > 0 && (
                  <span className="absolute -right-2 -top-2 z-10 flex min-w-12 items-center justify-center rounded-full bg-primary px-3 py-2 text-2xl font-extrabold tabular-nums text-primary-foreground shadow-md">
                    {count}
                  </span>
                )
              );

              // Мигает только сам бейдж таймера (запрос пользователя
              // 2026-07-28: "не весь тайл, только сам таймер") — рамка тайла
              // просто меняет цвет, без анимации.
              const tileBorder = openLaunch ? (expired || nearExpiry ? "border-destructive" : "border-primary") : "border-border";

              return (
                <PressableScale key={a.id} className="relative">
                  {badge}
                  <button
                    type="button"
                    onClick={() => {
                      if (!openLaunch) {
                        handleTileTap(a);
                      } else if (expired) {
                        releaseLaunch(openLaunch.id);
                      } else {
                        setInteracting(openLaunch.id);
                      }
                    }}
                    disabled={openLaunch ? stopping : !a.active || submitting}
                    className={cn(
                      "flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] disabled:opacity-40",
                      tileBorder
                    )}
                  >
                    {header}
                    <div className="flex flex-col gap-0.5 rounded-b-card p-3" style={{ background: colorTagGradient(a.colorTag) }}>
                      <span className="truncate text-[0.90625rem] font-bold tracking-[-0.01em]">{a.name}</span>
                      {zoneFilter === ALL_ZONES && zones.length > 1 && (
                        <span className="truncate text-[0.75rem] text-muted-foreground">{a.zoneName}</span>
                      )}
                    </div>
                  </button>
                </PressableScale>
              );
            })}
          </div>
        )}
      </div>

      <BottomSheet open={tapFlow !== null} onClose={() => setTapFlow(null)}>
        {tapFlow && !tapFlow.tariffId && tapZone && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.pickOptionTitle}</h2>
            <div className="flex flex-col gap-2">
              {tapZone.tariffs.map((tf) => (
                <PressableScale key={tf.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-between font-semibold"
                    disabled={submitting}
                    onClick={() => setTapFlow({ zoneId: tapFlow.zoneId, assetId: tapFlow.assetId, tariffId: tf.id })}
                  >
                    <span>{tf.name}</span>
                    {/* У таймерного тарифа (pricingMode="fixed") price — 0,
                        незначащий placeholder (реальные цены в options,
                        показываются на следующем шаге) — Money(0) тут был бы
                        обманчив. */}
                    {tf.pricingMode === "fixed" ? (
                      <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.tally.timedTariffHint}</span>
                    ) : (
                      <Money value={tf.price} />
                    )}
                  </Button>
                </PressableScale>
              ))}
            </div>
          </div>
        )}
        {tapFlow?.tariffId && tapIsTimed && !tapFlow.optionId && tapTariff && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.pickOptionTitle}</h2>
            <div className="flex flex-col gap-2">
              {tapTariff.options.map((opt) => (
                <PressableScale key={opt.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-between font-semibold"
                    disabled={submitting}
                    onClick={() =>
                      setTapFlow({ zoneId: tapFlow.zoneId, assetId: tapFlow.assetId, tariffId: tapFlow.tariffId, optionId: opt.id })
                    }
                  >
                    <span>{opt.name ?? formatMMSS(opt.durationMinutes * 60000)}</span>
                    <Money value={opt.price} />
                  </Button>
                </PressableScale>
              ))}
            </div>
          </div>
        )}
        {tapFlow?.tariffId && (!tapIsTimed || tapFlow.optionId) && tapAsset && tapTariff && tapPrice != null && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.paymentMethodTitle}</h2>
            <p className={cn("text-caption-airbnb text-muted-foreground")}>
              {tapAsset.name} · {tapTariff.name} · <Money value={tapPrice} />
            </p>
            <div className="flex flex-col gap-2">
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={submitting}
                silent
                onConfirm={() => logTap(tapFlow.zoneId, tapFlow.assetId, tapFlow.tariffId!, "cash", undefined, undefined, tapFlow.optionId)}
              >
                <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.cashLabel}
              </ConfirmButton>
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={submitting}
                silent
                onConfirm={() => logTap(tapFlow.zoneId, tapFlow.assetId, tapFlow.tariffId!, "mobile", undefined, undefined, tapFlow.optionId)}
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
                    disabled={submitting}
                    onClick={() => {
                      const target = {
                        zoneId: tapFlow.zoneId,
                        assetId: tapFlow.assetId,
                        tariffId: tapFlow.tariffId!,
                        optionId: tapFlow.optionId,
                        amount: tapPrice,
                      };
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
                  setSplitTapTarget({
                    zoneId: tapFlow.zoneId,
                    assetId: tapFlow.assetId,
                    tariffId: tapFlow.tariffId!,
                    optionId: tapFlow.optionId,
                    amount: tapPrice,
                  });
                  setTapFlow(null);
                }}
              >
                <ArrowLeftRight className="size-3.5" />
                {t.splitPayment.title}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <AbonementPaymentSheet
        open={abonementTarget !== null}
        onClose={() => setAbonementTarget(null)}
        amount={abonementTarget?.amount ?? 0}
        silent
        onConfirm={(walletId) => {
          if (!abonementTarget) return undefined;
          // return — тот же фикс, что и в game-room/page.tsx (аудит
          // 2026-07-24, найдено само-ревью моей же предыдущей правки).
          return logTap(
            abonementTarget.zoneId,
            abonementTarget.assetId,
            abonementTarget.tariffId,
            "abonement",
            walletId,
            undefined,
            abonementTarget.optionId
          );
        }}
      />

      <SplitPaymentSheet
        open={splitTapTarget !== null}
        onClose={() => setSplitTapTarget(null)}
        total={splitTapTarget?.amount ?? 0}
        allowedMethods={TALLY_SPLIT_METHODS}
        clientsEnabled={clientsEnabled}
        submitting={submitting}
        onSubmit={(legs) =>
          splitTapTarget
            ? logTap(splitTapTarget.zoneId, splitTapTarget.assetId, splitTapTarget.tariffId, "cash", undefined, legs, splitTapTarget.optionId)
            : undefined
        }
      />

      {/* Квитанция пуска — печать по требованию (модуль печати, запрос
          пользователя 2026-07-20), сразу после тапа. lastTap уже
          отфильтрован по zone.printReceiptEnabled внутри logTap. */}
      <BottomSheet open={lastTap !== null} onClose={() => setLastTap(null)}>
        {lastTap && (
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.tally.receiptDoneTitle}</h2>
            <p className="text-body-airbnb text-muted-foreground">
              {lastTap.assetName} · {lastTap.tariffName} · <Money value={lastTap.amount} />
            </p>
            {printAvailable.available && (
              <PrintButton
                label={t.operatorApp.gameRoom.printReceiptButton}
                data={buildTapReceiptData(lastTap)}
                branding={printAvailable.branding}
                className="w-full gap-1.5 rounded-lg"
              />
            )}
            <PressableScale className="w-full">
              <Button type="button" variant="outline" className="h-11 w-full rounded-lg" onClick={() => setLastTap(null)}>
                {t.common.close}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>
      <ActionToast message={errorToast.message} variant={errorToast.variant} />
    </div>
  );
}
