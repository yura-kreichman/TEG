"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Banknote, Check, CreditCard, Layers, MapPin, Plus, Wallet, X } from "lucide-react";
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
import { useLiveNow } from "@/hooks/use-live-now";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import type { PrintDocumentData } from "@/lib/print/receipt-document";
import { isStaysZone } from "@/lib/results-calc";
import { estimateLiveAmount, formatMMSS, type LaunchPricingMode, type LaunchRoundingMode } from "@/lib/game-room-client";
import { unlockBeep, playBeep, playConfirmChime, playCloseChime } from "@/lib/beep";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { formatMoneyWithCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AssetTariffOption {
  id: string;
  durationMinutes: number;
  price: number;
}

interface AssetTariffCtx {
  pricingMode: LaunchPricingMode | null;
  options: AssetTariffOption[];
}

interface AssetCtx {
  id: string;
  name: string;
  iconKey: string | null;
  photoUrl: string | null;
  colorTag: string;
  active: boolean;
  // "За вход" — несколько вариантов длительность+цена (запрос пользователя
  // 2026-07-17: "1 час, 2 часа..." — выбирает оператор при старте пуска),
  // null если у актива ещё не выбран тариф.
  tariff: AssetTariffCtx | null;
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
  printReceiptEnabled: boolean;
}

interface OpenLaunch {
  id: string;
  assetId: string | null;
  number: number;
  startedAt: string;
  pricingMode: LaunchPricingMode;
  priceSnapshot: number;
  durationMinutesSnapshot: number | null;
  roundingModeSnapshot: LaunchRoundingMode | null;
  minAmountSnapshot: number | null;
}

const SOUND_HINT_KEY = "gameRoomSoundHintSeen";
const ZONE_FILTER_KEY = "gameRoomZoneFilter";
const POLL_MS = 6000;
const ALL_ZONES = "all";

/**
 * Экран "Прибывания" в PWA оператора (docs/spec/04-game-room.md) — точка
 * входа из нижнего бара напрямую сюда, без промежуточного списка зон
 * (запрос пользователя 2026-07-17: "открываются все активы с dropdown
 * фильтром по зонам", отменяет прежний отдельный экран-список зон). Активы
 * ВСЕХ зон режима "stays" — в одном тайловом гриде, dropdown сверху сужает
 * его до одной зоны. Браслеты — тайлами, привязаны к выбранному активу; их
 * зона определяется активом (selectedZoneId), а не URL.
 */
export default function StaysZonePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();
  const now = useLiveNow();
  const printAvailable = useOperatorPrintAvailable();

  const [zones, setZones] = useState<ZoneCtx[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string>(ALL_ZONES);
  const [launches, setLaunches] = useState<OpenLaunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Добавление браслета "За вход" — вариант длительности (если их
  // несколько) и способ оплаты в ОДНОМ sheet, одним потоком (запрос
  // пользователя 2026-07-17: "надо сразу при старте... в одном"), цена
  // известна заранее — оплата берётся сразу, а не при возврате браслета
  // (в отличие от "По факту", там способ оплаты спрашивается при остановке).
  const [addFlow, setAddFlow] = useState<{ stage: "duration" | "payment"; optionId?: string } | null>(null);

  // Подтверждение остановки "Точно?" — прямо внутри тайла браслета, без
  // отдельного sheet (запрос пользователя 2026-07-17: "вопрос 'Точно'
  // должен появляться внутри тайла"). Способ оплаты "По факту" — наоборот,
  // отдельным bottom sheet (запрос того же дня: "тоже должны появляться
  // bottom sheet"); пуск не закрывается, пока способ не выбран — глобально
  // для обоих тарифов: "За вход" получает способ оплаты ещё при старте
  // (см. addFlow выше), "По факту" — здесь, перед самой остановкой.
  const [interacting, setInteracting] = useState<string | null>(null);
  const [stopPaymentTarget, setStopPaymentTarget] = useState<OpenLaunch | null>(null);
  const [stopping, setStopping] = useState(false);
  // Модуль печати (запрос пользователя 2026-07-20) — квитанция посещения,
  // кнопка появляется сразу после остановки пуска, только если и глобально
  // включена печать (на устройстве), и в этой конкретной зоне владелец
  // включил printReceiptEnabled — печатать нечего/незачем предлагать там,
  // где эта настройка выключена.
  const [lastStopped, setLastStopped] = useState<{
    zoneName: string;
    assetName: string;
    number: number;
    amount: number;
    startedAt: string;
    endedAt: string;
    paymentMethod: string | null;
    pricingMode: LaunchPricingMode;
  } | null>(null);

  // Оплата абонементом (запрос пользователя 2026-07-17) — третий способ
  // наравне с наличными/безналом, отдельный sheet (поиск/создание/
  // пополнение кошелька), открывается ПОВЕРХ addFlow/stopPaymentTarget
  // (те закрываются в момент тапа "Абонемент"), amount известен сразу —
  // либо цена выбранного варианта "За вход", либо живая сумма "По факту".
  const [abonementTarget, setAbonementTarget] = useState<
    { kind: "start"; optionId?: string; amount: number } | { kind: "stop"; launch: OpenLaunch; amount: number } | null
  >(null);

  const [soundHintOpen, setSoundHintOpen] = useState(false);
  const alertedRef = useRef<Set<string>>(new Set());

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window !== "undefined" && !window.localStorage.getItem(SOUND_HINT_KEY)) {
      setSoundHintOpen(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function dismissSoundHint() {
    unlockBeep();
    window.localStorage.setItem(SOUND_HINT_KEY, "1");
    setSoundHintOpen(false);
  }

  function loadZones() {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          router.replace("/operator/login");
          return;
        }
        const stays: ZoneCtx[] = (data.zones ?? [])
          .filter(isStaysZone)
          .map(
            (z: { id: string; name: string; iconKey: string | null; assets: AssetCtx[]; printReceiptEnabled: boolean }) => ({
              id: z.id,
              name: z.name,
              iconKey: z.iconKey,
              assets: z.assets ?? [],
              printReceiptEnabled: z.printReceiptEnabled,
            })
          );
        if (stays.length === 0) {
          router.replace("/operator");
          return;
        }
        setZones(stays);
        // Переход из мастера сдачи итогов ведёт сразу к активу с открытыми
        // пусками (запрос пользователя 2026-07-17: "не по отношению к Зоне,
        // а к Активу с переходом на Актуальный Актив") — актив однозначно
        // определяет и зону, сужаем dropdown до неё же. Без такого перехода —
        // восстанавливаем последний выбор фильтра из localStorage (запрос
        // пользователя 2026-07-18: "должен запоминаться статус выбранной
        // Зоны, а не быть по умолчанию Все зоны при открытии").
        const requestedAssetId = searchParams.get("assetId");
        const all = stays.flatMap((z) => z.assets.map((a) => ({ ...a, zoneId: z.id })));
        setSelectedAssetId((prev) => {
          if (prev) return prev;
          if (requestedAssetId) {
            const found = all.find((a) => a.id === requestedAssetId);
            if (found) {
              setZoneFilter(found.zoneId);
              return found.id;
            }
          }
          const savedZoneFilter = window.localStorage.getItem(ZONE_FILTER_KEY);
          if (savedZoneFilter && stays.some((z) => z.id === savedZoneFilter)) {
            setZoneFilter(savedZoneFilter);
            return all.find((a) => a.zoneId === savedZoneFilter)?.id ?? all[0]?.id ?? null;
          }
          return all[0]?.id ?? null;
        });
        setLoading(false);
      });
  }

  function loadLaunches(zoneId: string | null) {
    if (!zoneId) {
      setLaunches([]);
      return;
    }
    fetch(`/api/zones/${zoneId}/launches`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setLaunches(data.launches ?? []);
      });
  }

  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allAssets: AssetWithZone[] = useMemo(
    () => zones.flatMap((z) => z.assets.map((a) => ({ ...a, zoneId: z.id, zoneName: z.name }))),
    [zones]
  );
  const filteredAssets = zoneFilter === ALL_ZONES ? allAssets : allAssets.filter((a) => a.zoneId === zoneFilter);
  const selectedAsset = allAssets.find((a) => a.id === selectedAssetId) ?? null;
  const selectedZoneId = selectedAsset?.zoneId ?? null;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadLaunches(selectedZoneId);
    if (!selectedZoneId) return;
    const interval = setInterval(() => loadLaunches(selectedZoneId), POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZoneId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Сигнал истечения (docs/spec/04-game-room.md) — только fixed с длительностью,
  // разово на каждый пуск, по всей ТЕКУЩЕЙ (выбранной активом) зоне, не
  // только выбранному в переключателе активу.
  useEffect(() => {
    for (const l of launches) {
      if (l.pricingMode !== "fixed" || l.durationMinutesSnapshot == null) continue;
      const expiresAt = new Date(l.startedAt).getTime() + l.durationMinutesSnapshot * 60000;
      if (now.getTime() >= expiresAt && !alertedRef.current.has(l.id)) {
        alertedRef.current.add(l.id);
        playBeep();
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
      }
    }
  }, [launches, now]);

  function isExpired(l: OpenLaunch): boolean {
    if (l.pricingMode !== "fixed" || l.durationMinutesSnapshot == null) return false;
    const expiresAt = new Date(l.startedAt).getTime() + l.durationMinutesSnapshot * 60000;
    return now.getTime() >= expiresAt;
  }

  const launchesByAsset = useMemo(() => {
    const map = new Map<string, OpenLaunch[]>();
    for (const l of launches) {
      if (!l.assetId) continue;
      if (!map.has(l.assetId)) map.set(l.assetId, []);
      map.get(l.assetId)!.push(l);
    }
    // По времени старта, не по номеру (запрос пользователя 2026-07-17: номер
    // переиспользуется от освободившихся браслетов, поэтому сортировка по
    // номеру заставляла бы тайлы скакать местами — по времени добавления
    // порядок стабилен, новый браслет всегда встаёт последним, рядом с "+").
    for (const list of map.values()) list.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    return map;
  }, [launches]);

  // "За вход" с несколькими вариантами — оператор обязан выбрать один при
  // старте (запрос пользователя 2026-07-17), с одним вариантом — старт
  // мгновенный, тот же вариант подставляется автоматически (старт не должен
  // требовать больше двух тапов, docs/spec/04-game-room.md).
  function fixedOptions(tariff: AssetTariffCtx | null): AssetTariffOption[] {
    return tariff?.pricingMode === "fixed" ? tariff.options : [];
  }

  async function startLaunch(
    optionId?: string,
    paymentMethod?: "cash" | "mobile" | "abonement",
    abonementWalletId?: string
  ) {
    if (!selectedAssetId || !selectedZoneId) return;
    setStarting(true);
    setError(null);
    unlockBeep();
    try {
      const res = await fetch(`/api/zones/${selectedZoneId}/launches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: selectedAssetId, optionId, paymentMethod, abonementWalletId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.noPricingError);
        return;
      }
      // Звук подтверждения (запрос пользователя 2026-07-20) — "бам-бум",
      // браслет открыт.
      playConfirmChime();
      loadLaunches(selectedZoneId);
      setAddFlow(null);
      setAbonementTarget(null);
    } catch {
      // Сетевая ошибка (не HTTP-ошибка от сервера) — docs/spec/04-game-room.md,
      // Шаг 6: "стоп даёт внятную ошибку и не теряет пуск" — то же верно и для
      // старта. Ничего на сервере не создалось, повтор безопасен.
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStarting(false);
    }
  }

  async function stopLaunch(
    launchId: string,
    paymentMethod?: "cash" | "mobile" | "abonement",
    abonementWalletId?: string
  ) {
    setStopping(true);
    setError(null);
    // Снимок для квитанции ДО запроса — после успешного стопа сам launch
    // пропадает из локального списка (loadLaunches грузит только открытые).
    const launch = launches.find((l) => l.id === launchId);
    const zone = zones.find((z) => z.id === selectedZoneId);
    const asset = launch ? allAssets.find((a) => a.id === launch.assetId) : null;
    try {
      const res = await fetch(`/api/launches/${launchId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod, abonementWalletId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "");
        return;
      }
      const data = await res.json();
      // Звук подтверждения (запрос пользователя 2026-07-20) — "бум-бам",
      // те же две ноты в обратном порядке, браслет закрыт.
      playCloseChime();
      setInteracting(null);
      setStopPaymentTarget(null);
      setAbonementTarget(null);
      loadLaunches(selectedZoneId);
      if (launch && zone && asset && zone.printReceiptEnabled && printAvailable.available) {
        setLastStopped({
          zoneName: zone.name,
          assetName: asset.name,
          number: launch.number,
          amount: Number(data.amount),
          startedAt: launch.startedAt,
          endedAt: data.endedAt,
          // Способ оплаты приходит с сервера, не из локального paymentMethod-
          // аргумента этой функции — у тарифа "За вход" стоп вызывается вообще
          // без него (способ оплаты уже выбран и сохранён раньше, при старте,
          // см. комментарий в /api/launches/[id]/stop) — сервер знает оба
          // случая, клиент сам по себе не всегда.
          paymentMethod: data.paymentMethod ?? null,
          pricingMode: launch.pricingMode,
        });
      }
    } catch {
      // Пуск на сервере не потерян (запрос мог не дойти или ответ не
      // вернуться) — оператор видит понятную ошибку и может повторить, повтор
      // на уже закрытый пуск сервер отклонит отдельной проверкой isOpen.
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStopping(false);
    }
  }

  const stayPaymentMethodLabel: Record<string, string> = {
    cash: t.operatorApp.submit.cashLabel,
    mobile: t.operatorApp.submit.mobileLabel,
    abonement: t.reports.abonementLabel,
  };

  // Квитанция посещения (модуль печати, запрос пользователя 2026-07-20) —
  // печать по требованию, сразу после остановки пуска.
  function buildStayReceiptData(s: NonNullable<typeof lastStopped>): PrintDocumentData {
    const minutes = Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000);
    return {
      title: t.operatorApp.gameRoom.receiptTitle,
      subtitle: `${s.zoneName} · ${new Date(s.endedAt).toLocaleString(locale)}${printAvailable.operatorName ? ` · ${printAvailable.operatorName}` : ""}`,
      sections: [
        {
          lines: [
            { label: `${s.assetName} · ${t.operatorApp.gameRoom.wristbandNumberPrefix} ${s.number}`, value: "" },
            // Длительность имеет смысл только у "По факту" (цена зависит от
            // фактического времени) — у "За вход" клиент платит за
            // фиксированный вариант (например, "30 минут"), а не за реально
            // проведённое время, показывать здесь минуты незачем и путает
            // (запрос пользователя 2026-07-20: "это уже дело клиента").
            ...(s.pricingMode === "per_minute"
              ? [
                  {
                    label: t.operatorApp.gameRoom.receiptDurationLabel,
                    value: `${minutes} ${t.operatorApp.gameRoom.receiptMinutesSuffix}`,
                  },
                ]
              : []),
            ...(s.paymentMethod
              ? [
                  {
                    label: t.operatorApp.gameRoom.receiptPaymentMethodLabel,
                    value: stayPaymentMethodLabel[s.paymentMethod] ?? s.paymentMethod,
                  },
                ]
              : []),
          ],
        },
      ],
      totalLine: { label: t.operatorApp.gameRoom.receiptAmountLabel, value: formatMoneyWithCurrency(s.amount, locale, currency) },
    };
  }

  if (loading) return null;

  const filterZone = zones.find((z) => z.id === zoneFilter) ?? null;
  const selectedLaunches = selectedAssetId ? launchesByAsset.get(selectedAssetId) ?? [] : [];
  const selectedOptions = fixedOptions(selectedAsset?.tariff ?? null);

  function handleAddTap() {
    if (!selectedAsset || !selectedAsset.active || !selectedAsset.tariff) return;
    if (selectedAsset.tariff.pricingMode === "fixed") {
      setAddFlow(
        selectedOptions.length > 1 ? { stage: "duration" } : { stage: "payment", optionId: selectedOptions[0]?.id }
      );
      return;
    }
    // "По факту" — старт мгновенный, способ оплаты спросится при остановке
    // (сумма известна только тогда), см. stopLaunch.
    startLaunch();
  }

  const addDisabled = starting || !selectedAsset?.active || !selectedAsset?.tariff;

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6" onPointerDownCapture={() => unlockBeep()}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-xl lg:max-w-2xl">
        <h1 className="mb-4 text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.gameRoom.entryTitle}</h1>

        {zones.length > 1 && (
          <div className="mb-4 flex items-center gap-2">
            <Label className="shrink-0">{t.operatorApp.gameRoom.zoneFilterLabel}</Label>
            <div className="min-w-0 flex-1">
              <Select
                value={zoneFilter}
                onValueChange={(v) => {
                  if (!v) return;
                  setZoneFilter(v);
                  window.localStorage.setItem(ZONE_FILTER_KEY, v);
                }}
                items={[
                  { value: ALL_ZONES, label: t.operatorApp.gameRoom.allZonesOption },
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
                      {filterZone ? filterZone.name : t.operatorApp.gameRoom.allZonesOption}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONES}>
                    <span className="flex items-center gap-2">
                      <Layers className="size-5 shrink-0 text-muted-foreground" />
                      {t.operatorApp.gameRoom.allZonesOption}
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
        ) : filteredAssets.length === 1 ? (
          // Один-единственный актив в зоне — выбирать не из чего (запрос
          // пользователя 2026-07-18: "Батутные арены" с единственной "Ареной
          // синей" — нет смысла показывать выбор), достаточно значка,
          // цветовой метки и названия одной строкой, без кликабельного тайла.
          <div className="mb-4 flex items-center gap-2.5 rounded-card border border-border bg-card p-3">
            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
              {filteredAssets[0].photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={filteredAssets[0].photoUrl} alt="" className="size-full object-contain object-center" />
              ) : filteredAssets[0].iconKey ? (
                <AssetOrZoneIcon iconKey={filteredAssets[0].iconKey} className="size-5 text-muted-foreground" />
              ) : (
                <MapPin className="size-5 text-muted-foreground" />
              )}
            </div>
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: filteredAssets[0].colorTag }}
            />
            <span className="truncate text-[0.90625rem] font-bold tracking-[-0.01em]">{filteredAssets[0].name}</span>
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
              {filteredAssets.map((a) => {
                const active = a.id === selectedAssetId;
                return (
                    <PressableScale key={a.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedAssetId(a.id)}
                        className={cn(
                          "flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left",
                          active ? "border-primary" : "border-border"
                        )}
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
                          {/* Явная отметка выбранного актива (запрос
                              пользователя 2026-07-18: "чтобы было очевидно
                              какой актив выбран") — раньше единственным
                              сигналом была тонкая цветная рамка тайла,
                              недостаточно заметная. Размер и позиция — как у
                              счётчика пусков на экране "Пуски" (тот же
                              min-w-11/rounded-full/shadow-md в углу тайла). */}
                          {active && (
                            <span className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full bg-success text-success-foreground shadow-md ring-2 ring-card">
                              <Check className="size-6" />
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 p-3">
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
          </>
        )}

        {filteredAssets.length > 0 && (
          <>
            {selectedAsset && !selectedAsset.tariff && (
              <p className="mb-3 text-caption-airbnb text-destructive">{t.operatorApp.gameRoom.noPricingError}</p>
            )}

            {selectedAsset && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
                {selectedLaunches.map((l) => {
                  const expired = isExpired(l);
                  const elapsedMs = now.getTime() - new Date(l.startedAt).getTime();
                  const liveAmount = estimateLiveAmount(
                    l.pricingMode,
                    l.priceSnapshot,
                    l.roundingModeSnapshot,
                    l.minAmountSnapshot,
                    new Date(l.startedAt),
                    now
                  );
                  const timeText =
                    l.pricingMode === "fixed" && l.durationMinutesSnapshot != null
                      ? formatMMSS(l.durationMinutesSnapshot * 60000 - elapsedMs)
                      : formatMMSS(elapsedMs);
                  // "Точно?" — инлайн в тайле (запрос пользователя 2026-07-17).
                  // Способ оплаты "По факту" дальше уходит в отдельный bottom
                  // sheet (запрос того же дня), не остаётся в тайле.
                  if (interacting === l.id) {
                    return (
                      <div
                        key={l.id}
                        className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-card border-[1.5px] border-primary bg-card p-2 text-center"
                      >
                        {l.pricingMode === "per_minute" && <Money value={liveAmount} className="text-lg font-extrabold" />}
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
                              onClick={() => {
                                setInteracting(null);
                                if (l.pricingMode === "per_minute") {
                                  setStopPaymentTarget(l);
                                } else {
                                  stopLaunch(l.id);
                                }
                              }}
                              className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
                            >
                              <Check className="size-4" />
                            </button>
                          </PressableScale>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <PressableScale key={l.id}>
                      <button
                        type="button"
                        onClick={() => setInteracting(l.id)}
                        className={cn(
                          "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-card border-[1.5px] bg-card p-2 text-center",
                          expired ? "border-destructive motion-safe:animate-pulse" : "border-primary"
                        )}
                      >
                        <span className="text-[0.6875rem] font-semibold text-muted-foreground">
                          {t.operatorApp.gameRoom.wristbandNumberPrefix} {l.number}
                        </span>
                        <span
                          className={cn(
                            "tabular-nums",
                            l.pricingMode === "fixed"
                              ? cn("text-2xl font-extrabold", expired && "text-destructive")
                              : "text-sm font-semibold text-muted-foreground"
                          )}
                        >
                          {expired ? t.operatorApp.gameRoom.expiredLabel : timeText}
                        </span>
                        {l.pricingMode === "per_minute" && (
                          <Money value={liveAmount} className="text-2xl font-extrabold" />
                        )}
                      </button>
                    </PressableScale>
                  );
                })}

                <PressableScale>
                  <button
                    type="button"
                    onClick={handleAddTap}
                    disabled={addDisabled}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-card border-[1.5px] border-dashed border-border p-2 text-center text-muted-foreground disabled:opacity-40"
                  >
                    <Plus className="size-5" />
                    <span className="text-[0.75rem] font-semibold leading-tight">
                      {t.operatorApp.gameRoom.addWristbandLabel}
                    </span>
                  </button>
                </PressableScale>
              </div>
            )}
          </>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {/* Добавление браслета "За вход" — один sheet, два последовательных
          шага (запрос пользователя 2026-07-17: "в одном"): вариант
          длительности (если их несколько) → способ оплаты. Цена известна
          заранее, поэтому оплата берётся сразу при старте, не при возврате
          браслета. */}
      <BottomSheet open={addFlow !== null} onClose={() => setAddFlow(null)}>
        {addFlow?.stage === "duration" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.pickOptionTitle}</h2>
            <div className="flex flex-col gap-2">
              {selectedOptions.map((opt) => (
                <PressableScale key={opt.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-between font-semibold"
                    disabled={starting}
                    onClick={() => setAddFlow({ stage: "payment", optionId: opt.id })}
                  >
                    <span>
                      {opt.durationMinutes} {t.operatorApp.workTime.minutesShort}
                    </span>
                    <Money value={opt.price} />
                  </Button>
                </PressableScale>
              ))}
            </div>
          </div>
        )}
        {addFlow?.stage === "payment" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.operatorApp.gameRoom.paymentMethodTitle}
            </h2>
            <div className="flex flex-col gap-2">
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={starting}
                onConfirm={() => startLaunch(addFlow.optionId, "cash")}
              >
                <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.cashLabel}
              </ConfirmButton>
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={starting}
                onConfirm={() => startLaunch(addFlow.optionId, "mobile")}
              >
                <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.mobileLabel}
              </ConfirmButton>
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  className="relative h-12 w-full font-semibold"
                  disabled={starting}
                  onClick={() => {
                    const amount = selectedOptions.find((o) => o.id === addFlow.optionId)?.price ?? 0;
                    setAddFlow(null);
                    setAbonementTarget({ kind: "start", optionId: addFlow.optionId, amount });
                  }}
                >
                  <Wallet className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                  {t.operatorApp.abonement.paymentLabel}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Способ оплаты "По факту" при остановке — отдельный bottom sheet
          (запрос пользователя 2026-07-17: "тоже должны появляться bottom
          sheet"), не остаётся в тайле, в отличие от "Точно?" выше. Пуск не
          останавливается, пока способ не выбран. */}
      <BottomSheet open={stopPaymentTarget !== null} onClose={() => setStopPaymentTarget(null)}>
        {stopPaymentTarget && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.operatorApp.gameRoom.paymentMethodTitle}
            </h2>
            <p className="text-caption-airbnb tabular-nums">
              {t.operatorApp.gameRoom.wristbandNumberPrefix} {stopPaymentTarget.number} ·{" "}
              <Money
                value={estimateLiveAmount(
                  stopPaymentTarget.pricingMode,
                  stopPaymentTarget.priceSnapshot,
                  stopPaymentTarget.roundingModeSnapshot,
                  stopPaymentTarget.minAmountSnapshot,
                  new Date(stopPaymentTarget.startedAt),
                  now
                )}
              />
            </p>
            <div className="flex flex-col gap-2">
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={stopping}
                onConfirm={() => stopLaunch(stopPaymentTarget.id, "cash")}
              >
                <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.cashLabel}
              </ConfirmButton>
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={stopping}
                onConfirm={() => stopLaunch(stopPaymentTarget.id, "mobile")}
              >
                <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.mobileLabel}
              </ConfirmButton>
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  className="relative h-12 w-full font-semibold"
                  disabled={stopping}
                  onClick={() => {
                    const amount = estimateLiveAmount(
                      stopPaymentTarget.pricingMode,
                      stopPaymentTarget.priceSnapshot,
                      stopPaymentTarget.roundingModeSnapshot,
                      stopPaymentTarget.minAmountSnapshot,
                      new Date(stopPaymentTarget.startedAt),
                      now
                    );
                    const launch = stopPaymentTarget;
                    setStopPaymentTarget(null);
                    setAbonementTarget({ kind: "stop", launch, amount });
                  }}
                >
                  <Wallet className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                  {t.operatorApp.abonement.paymentLabel}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      <AbonementPaymentSheet
        open={abonementTarget !== null}
        onClose={() => setAbonementTarget(null)}
        amount={abonementTarget?.amount ?? 0}
        onConfirm={(walletId) => {
          if (!abonementTarget) return;
          if (abonementTarget.kind === "start") startLaunch(abonementTarget.optionId, "abonement", walletId);
          else stopLaunch(abonementTarget.launch.id, "abonement", walletId);
        }}
      />

      {/* Квитанция посещения — печать по требованию (модуль печати, запрос
          пользователя 2026-07-20), сразу после остановки пуска. Появляется,
          только если lastStopped вообще выставлен (сама stopLaunch уже
          отфильтровала по zone.printReceiptEnabled). */}
      <BottomSheet open={lastStopped !== null} onClose={() => setLastStopped(null)}>
        {lastStopped && (
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.receiptDoneTitle}</h2>
            <p className="text-body-airbnb text-muted-foreground">
              {lastStopped.assetName} · {t.operatorApp.gameRoom.wristbandNumberPrefix} {lastStopped.number} ·{" "}
              <Money value={lastStopped.amount} />
            </p>
            {printAvailable.available && (
              <PrintButton
                label={t.operatorApp.gameRoom.printReceiptButton}
                data={buildStayReceiptData(lastStopped)}
                branding={printAvailable.branding}
                className="w-full gap-1.5 rounded-lg"
              />
            )}
            <PressableScale className="w-full">
              <Button type="button" variant="outline" className="h-11 w-full rounded-lg" onClick={() => setLastStopped(null)}>
                {t.common.close}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={soundHintOpen} onClose={dismissSoundHint}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.entryTitle}</h2>
          <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.gameRoom.soundHintBody}</p>
          <PressableScale>
            <Button className="h-12 w-full font-bold" onClick={dismissSoundHint}>
              {t.common.close}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>
    </div>
  );
}
