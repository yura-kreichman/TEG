"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Banknote, Check, CreditCard, Layers, MapPin, Play, Plus, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { Money, computeMoneyDisplayScale } from "@/components/money";
import { PrintButton } from "@/components/print/print-button";
import { useLiveNow } from "@/hooks/use-live-now";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import { useLiveRefetch } from "@/hooks/use-live-refetch";
import { useWakeLock } from "@/hooks/use-wake-lock";
import type { PrintDocumentData } from "@/lib/print/receipt-document";
import { isStaysZone } from "@/lib/results-calc";
import { COLOR_TAG_PALETTE } from "@/lib/color-tag";
import { estimateLiveAmount, formatMMSS, type LaunchPricingMode, type LaunchRoundingMode } from "@/lib/game-room-client";
import { unlockBeep, playBeep, playConfirmChime, playCloseChime, playErrorChime } from "@/lib/beep";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { LinkClientSheet, type LinkedClientInfo } from "@/components/link-client-sheet";
import { SplitPaymentSheet } from "@/components/split-payment-sheet";
import { ActionToast } from "@/components/action-toast";
import { useActionToast } from "@/hooks/use-action-toast";
import { formatMoney, formatMoneyWithCurrency } from "@/lib/format";
import type { PaymentLegInput } from "@/lib/payment-split";
import { cn, colorTagGradient } from "@/lib/utils";

// Те же значения, что LAUNCH_PAYMENT_METHODS в src/lib/game-room.ts — не
// импортируем сам модуль сюда (серверный), см. тот же приём в других
// operator-страницах этого проекта.
const LAUNCH_SPLIT_METHODS = ["cash", "mobile", "abonement"] as const;

interface AssetTariffOption {
  id: string;
  durationMinutes: number;
  price: number;
  // Только "per_minute" — название ставки ("Будни"/"Выходные"), null у "fixed".
  name: string | null;
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
  amountRoundingEnabled: boolean;
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
  // false — "заморожен" через /api/launches/[id]/lock, ждёт способ оплаты
  // (запрос пользователя 2026-07-27); amount тогда уже зафиксирован сервером,
  // не считается заново через estimateLiveAmount.
  isOpen: boolean;
  amount: number | null;
  // "Чей это ребёнок" (запрос пользователя 2026-07-27) — справочная метка,
  // не влияет на способ оплаты. null, пока не привязан или модуль Клиенты
  // выключен.
  linkedClient: LinkedClientInfo | null;
}

const SOUND_HINT_KEY = "gameRoomSoundHintSeen";
const ZONE_FILTER_KEY = "gameRoomZoneFilter";
// Запоминаем конкретный выбранный АКТИВ (не только зону, см. ZONE_FILTER_KEY
// выше) — запрос пользователя 2026-07-26: "чтобы когда возвращался сотрудник
// было то состояние выбранного Актива" — при переключении на Товары и
// обратно (нижний бар) этот экран перемонтируется, обычный useState теряет
// выбор, откатываясь на первый актив зоны.
const ASSET_SELECTION_KEY = "gameRoomSelectedAsset";
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
  const errorToast = useActionToast();
  function flashError(message: string) {
    playErrorChime();
    errorToast.flash(message, "error");
  }

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Добавление браслета "За вход" — вариант длительности (если их
  // несколько) и способ оплаты в ОДНОМ sheet, одним потоком (запрос
  // пользователя 2026-07-17: "надо сразу при старте... в одном"), цена
  // известна заранее — оплата берётся сразу, а не при возврате браслета
  // (в отличие от "По факту", там способ оплаты спрашивается при остановке).
  const [addFlow, setAddFlow] = useState<{ stage: "duration" | "rate" | "payment"; optionId?: string } | null>(null);

  // Подтверждение остановки "Точно?" — прямо внутри тайла браслета, без
  // отдельного sheet (запрос пользователя 2026-07-17: "вопрос 'Точно'
  // должен появляться внутри тайла"). Способ оплаты "По факту" — наоборот,
  // отдельным bottom sheet (запрос того же дня: "тоже должны появляться
  // bottom sheet"); пуск не закрывается, пока способ не выбран — глобально
  // для обоих тарифов: "За вход" получает способ оплаты ещё при старте
  // (см. addFlow выше), "По факту" — здесь, перед самой остановкой.
  const [interacting, setInteracting] = useState<string | null>(null);
  const [stopPaymentTarget, setStopPaymentTarget] = useState<OpenLaunch | null>(null);
  const [linkClientTarget, setLinkClientTarget] = useState<OpenLaunch | null>(null);
  const [stopping, setStopping] = useState(false);
  // resuming — аудит 2026-07-27, второй раунд: кнопка "Возобновить" была
  // единственным действием на этом экране без защиты от двойного тапа (у
  // старта/стопа она уже есть — starting/stopping выше).
  const [resuming, setResuming] = useState<string | null>(null);
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
    legs?: { method: string; amount: number }[];
    pricingMode: LaunchPricingMode;
  } | null>(null);

  // Разбивка оплаты (запрос пользователя 2026-07-26) — необязательные
  // отдельные sheet поверх обычных кнопок, свои для старта ("За вход") и
  // стопа ("По факту"), см. SplitPaymentSheet. Сумма фиксируется в момент
  // открытия (тот же приём, что abonementTarget ниже) — addFlow/
  // stopPaymentTarget обнуляются при закрытии своих sheet, к моменту сабмита
  // разбивки их уже может не быть.
  const [splitStartTarget, setSplitStartTarget] = useState<{ optionId?: string; amount: number } | null>(null);
  // "По факту" — в отличие от splitStartTarget выше, СУММА НЕ ФИКСИРУЕТСЯ в
  // момент открытия (аудит 2026-07-26, реальный баг) — при per_minute
  // тарификации цена растёт с каждой секундой, а сервер (validateSplitLegs
  // в /api/launches/[id]/stop) требует ТОЧНОГО совпадения суммы долей с
  // суммой, пересчитанной на момент запроса; замороженная сумма почти
  // всегда успевала разойтись с ней за время заполнения формы, и разбивка
  // "По факту" отклонялась с "Сумма долей не равна итоговой сумме" без вины
  // оператора. Храним только launch, сумма для SplitPaymentSheet считается
  // на каждый рендер тем же estimateLiveAmount+живым `now`, что и сама
  // плитка/шторка обычной оплаты — всегда совпадает с тем, что увидит сервер.
  const [splitStopTarget, setSplitStopTarget] = useState<{ launch: OpenLaunch } | null>(null);

  // Оплата абонементом (запрос пользователя 2026-07-17) — третий способ
  // наравне с наличными/безналом, отдельный sheet (поиск/создание/
  // пополнение кошелька), открывается ПОВЕРХ addFlow/stopPaymentTarget
  // (те закрываются в момент тапа "Абонемент"), amount известен сразу —
  // либо цена выбранного варианта "За вход", либо живая сумма "По факту".
  const [abonementTarget, setAbonementTarget] = useState<
    { kind: "start"; optionId?: string; amount: number } | { kind: "stop"; launch: OpenLaunch; amount: number } | null
  >(null);
  // Настройки → Система → "Модули" (запрос пользователя 2026-07-22) —
  // кнопка "Баланс" прячется целиком, если Владелец отключил Клиентов;
  // серверная защита уже есть в /api/zones/[id]/launches и /api/launches/[id]/stop.
  const [clientsEnabled, setClientsEnabled] = useState(true);

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
            (z: {
              id: string;
              name: string;
              iconKey: string | null;
              assets: AssetCtx[];
              printReceiptEnabled: boolean;
              amountRoundingEnabled: boolean;
            }) => ({
              id: z.id,
              name: z.name,
              iconKey: z.iconKey,
              assets: z.assets ?? [],
              printReceiptEnabled: z.printReceiptEnabled,
              amountRoundingEnabled: z.amountRoundingEnabled,
            })
          );
        if (stays.length === 0) {
          router.replace("/operator");
          return;
        }
        setZones(stays);
        setClientsEnabled(data.clientsEnabled !== false);
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
          // Сохранённый конкретный актив — приоритетнее сохранённой зоны
          // (та ниже просто берёт первый актив в зоне, это не то же самое,
          // что запомненный выбор конкретного тайла).
          const savedAssetId = window.localStorage.getItem(ASSET_SELECTION_KEY);
          if (savedAssetId) {
            const found = all.find((a) => a.id === savedAssetId);
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

  // Держит список зон/активов свежим, пока экран часами не покидают (запрос
  // пользователя 2026-07-22) — не трогает сами живые пуски (loadLaunches
  // отдельно), только состав зон/активов/тумблеров.
  // Экран не гаснет, пока открыт этот экран (запрос владельца 2026-08-13):
  // здесь тикают таймеры пусков, и сотрудник смотрит на них, а не трогает
  // планшет — системное затемнение гасит ровно то, ради чего экран открыт.
  useWakeLock();

  useLiveRefetch(loadZones);

  const allAssets: AssetWithZone[] = useMemo(
    () => zones.flatMap((z) => z.assets.map((a) => ({ ...a, zoneId: z.id, zoneName: z.name }))),
    [zones]
  );
  const filteredAssets = zoneFilter === ALL_ZONES ? allAssets : allAssets.filter((a) => a.zoneId === zoneFilter);
  const selectedAsset = allAssets.find((a) => a.id === selectedAssetId) ?? null;
  const selectedZoneId = selectedAsset?.zoneId ?? null;
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  /* eslint-disable react-hooks/set-state-in-effect */
  // Единственный актив в отфильтрованной зоне рендерится БЕЗ кликабельного
  // тайла (запрос пользователя 2026-07-18: "выбирать не из чего") — тапнуть
  // по нему и выставить selectedAssetId физически нечем. Реальный баг (нашла
  // Катя, тенант "Керен Центр", зона "PROдлёнка+" — 2026-07-27): при
  // переключении фильтра зоны на зону ровно с одним активом selectedAssetId
  // молча оставался от ПРЕДЫДУЩЕЙ зоны — "Добавить браслет" тогда стартовал
  // по чужому активу/тарифу (другая цена), а строка на экране выглядела
  // "не реагирующей", хотя на самом деле была не кликабельна вовсе.
  useEffect(() => {
    if (filteredAssets.length === 1 && filteredAssets[0].id !== selectedAssetId) {
      setSelectedAssetId(filteredAssets[0].id);
      window.localStorage.setItem(ASSET_SELECTION_KEY, filteredAssets[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneFilter, allAssets, selectedAssetId]);

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

  // Последние 30 секунд до истечения — таймер уже становится красным и
  // мигает, не только после самого истечения (запрос пользователя
  // 2026-07-28, тот же порог, что и у глобального баннера/"Пусков"): "сам
  // таймер тоже должен становиться красным при приближении времени".
  function isNearExpiry(l: OpenLaunch): boolean {
    if (l.pricingMode !== "fixed" || l.durationMinutesSnapshot == null) return false;
    const expiresAt = new Date(l.startedAt).getTime() + l.durationMinutesSnapshot * 60000;
    const remainingMs = expiresAt - now.getTime();
    return remainingMs > 0 && remainingMs <= 30000;
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

  // Несколько именованных ставок "По факту" (запрос пользователя 2026-07-26:
  // "в выходные один тариф, в будние другой") — та же логика выбора, что у
  // "За вход" выше: с одним вариантом старт мгновенный (вариант подставляется
  // автоматически), с несколькими — оператор выбирает. Тариф без вариантов
  // (все "По факту" до этой фичи) продолжает работать как раньше — вообще
  // без этого шага.
  function rateOptions(tariff: AssetTariffCtx | null): AssetTariffOption[] {
    return tariff?.pricingMode === "per_minute" ? tariff.options : [];
  }

  async function startLaunch(
    optionId?: string,
    paymentMethod?: "cash" | "mobile" | "abonement",
    abonementWalletId?: string,
    legs?: PaymentLegInput[]
  ) {
    if (!selectedAssetId || !selectedZoneId) return;
    setStarting(true);
    unlockBeep();
    try {
      const res = await fetch(`/api/zones/${selectedZoneId}/launches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: selectedAssetId, optionId, paymentMethod, abonementWalletId, legs }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.noPricingError);
        return;
      }
      // Звук подтверждения (запрос пользователя 2026-07-20) — "бам-бум",
      // браслет открыт.
      playConfirmChime();
      loadLaunches(selectedZoneId);
      setAddFlow(null);
      setAbonementTarget(null);
      setSplitStartTarget(null);
    } catch {
      // Сетевая ошибка (не HTTP-ошибка от сервера) — docs/spec/04-game-room.md,
      // Шаг 6: "стоп даёт внятную ошибку и не теряет пуск" — то же верно и для
      // старта. Ничего на сервере не создалось, повтор безопасен.
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStarting(false);
    }
  }

  async function stopLaunch(
    launchId: string,
    paymentMethod?: "cash" | "mobile" | "abonement",
    abonementWalletId?: string,
    legs?: PaymentLegInput[]
  ) {
    setStopping(true);
    // Снимок для квитанции ДО запроса — после успешного стопа сам launch
    // пропадает из локального списка (loadLaunches грузит только открытые).
    const launch = launches.find((l) => l.id === launchId);
    const zone = zones.find((z) => z.id === selectedZoneId);
    const asset = launch ? allAssets.find((a) => a.id === launch.assetId) : null;
    try {
      const res = await fetch(`/api/launches/${launchId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod, abonementWalletId, legs }),
      });
      if (!res.ok) {
        const data = await res.json();
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      const data = await res.json();
      // Звук подтверждения (запрос пользователя 2026-07-20) — "бум-бам",
      // те же две ноты в обратном порядке, браслет закрыт.
      playCloseChime();
      setInteracting(null);
      setStopPaymentTarget(null);
      setAbonementTarget(null);
      setSplitStopTarget(null);
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
          legs: legs && legs.length > 0 ? legs : undefined,
          pricingMode: launch.pricingMode,
        });
      }
    } catch {
      // Пуск на сервере не потерян (запрос мог не дойти или ответ не
      // вернуться) — оператор видит понятную ошибку и может повторить, повтор
      // на уже закрытый пуск сервер отклонит отдельной проверкой isOpen.
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStopping(false);
    }
  }

  // Фиксация суммы/времени "По факту" в момент открытия шторки выбора
  // способа оплаты (запрос пользователя 2026-07-27) — иначе сумма растёт,
  // пока Сотрудник/Клиент решают, чем платить. Сервер сам считает endedAt
  // (см. /api/launches/[id]/lock) — не клиентское время.
  async function lockLaunch(l: OpenLaunch) {
    setStopping(true);
    try {
      const res = await fetch(`/api/launches/${l.id}/lock`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        flashError(data?.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      const data = await res.json();
      const amount = Number(data.amount);
      loadLaunches(selectedZoneId);
      // Сумма 0 — закрываем сразу после "Точно?", без bottom sheet выбора
      // способа оплаты (реальный баг, найден пользователем 2026-07-28: сумма
      // 0 всё равно показывала шторку с единственной кнопкой "Закрыть без
      // оплаты" — лишний тап; договорённость раньше была "закрывается сразу").
      // paymentMethod="cash" на нулевую сумму ни на что не влияет.
      if (amount === 0) {
        await stopLaunch(l.id, "cash");
        return;
      }
      setStopPaymentTarget({ ...l, isOpen: false, amount });
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStopping(false);
    }
  }

  // Возврат зафиксированного, но ещё не оплаченного пуска в идущий (запрос
  // пользователя 2026-07-27: "передумал уходить") — тайл целиком становится
  // кнопкой "Возобновить" (серый + крупная иконка play), пока пуск ждёт
  // оплату.
  async function resumeLaunch(launchId: string) {
    if (resuming) return;
    setResuming(launchId);
    try {
      const res = await fetch(`/api/launches/${launchId}/resume`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        flashError(data?.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      loadLaunches(selectedZoneId);
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setResuming(null);
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
            // Разбивка оплаты (запрос пользователя 2026-07-26) — своя строка
            // на каждый способ вместо одной общей.
            ...(s.legs
              ? s.legs.map((leg) => ({
                  label: stayPaymentMethodLabel[leg.method] ?? leg.method,
                  value: formatMoneyWithCurrency(leg.amount, locale, currency),
                }))
              : s.paymentMethod
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
  const selectedRateOptions = rateOptions(selectedAsset?.tariff ?? null);

  function handleAddTap() {
    if (!selectedAsset || !selectedAsset.active || !selectedAsset.tariff) return;
    if (selectedAsset.tariff.pricingMode === "fixed") {
      setAddFlow(
        selectedOptions.length > 1 ? { stage: "duration" } : { stage: "payment", optionId: selectedOptions[0]?.id }
      );
      return;
    }
    // "По факту" — способ оплаты спросится при остановке (сумма известна
    // только тогда), см. stopLaunch. Ставка — если у тарифа несколько
    // именованных вариантов, оператор выбирает при старте (та же механика,
    // что у "За вход" длительностей); с одним/без вариантов — старт мгновенный.
    if (selectedRateOptions.length > 1) {
      setAddFlow({ stage: "rate" });
      return;
    }
    startLaunch(selectedRateOptions[0]?.id);
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
          <div
            className="mb-4 flex items-center gap-2.5 rounded-card border border-border bg-card p-3"
            style={{ background: colorTagGradient(filteredAssets[0].colorTag) }}
          >
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
            <span className="truncate text-[0.90625rem] font-bold tracking-[-0.01em]">{filteredAssets[0].name}</span>
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
              {filteredAssets.map((a) => {
                const active = a.id === selectedAssetId;
                return (
                    <PressableScale key={a.id} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAssetId(a.id);
                          window.localStorage.setItem(ASSET_SELECTION_KEY, a.id);
                        }}
                        className={cn(
                          "flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]",
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
                        </div>
                        <div className="flex flex-col gap-0.5 p-3" style={{ background: colorTagGradient(a.colorTag) }}>
                          <span className="truncate text-[0.90625rem] font-bold tracking-[-0.01em]">{a.name}</span>
                          {zoneFilter === ALL_ZONES && zones.length > 1 && (
                            <span className="truncate text-[0.75rem] text-muted-foreground">{a.zoneName}</span>
                          )}
                        </div>
                      </button>
                      {/* Явная отметка выбранного актива (запрос
                          пользователя 2026-07-18: "чтобы было очевидно какой
                          актив выбран") — раньше единственным сигналом была
                          тонкая цветная рамка тайла, недостаточно заметная.
                          Позиция/размер — тот же "торчащий за угол" приём,
                          что у бейджа привязки клиента и у "Сдачи итогов"
                          (запрос пользователя 2026-07-27: "сдвинь на угол
                          как иконка кошелька для единообразия"); снаружи
                          <button>, не внутри — иначе обрезалось бы
                          overflow-hidden фото-блока. */}
                      {active && (
                        <span className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-success text-success-foreground shadow-md">
                          <Check className="size-5" />
                        </span>
                      )}
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
            {/* Актив на паузе — тайл кликабелен, но "Добавить браслет" молча
                задизейблен ниже без всякого пояснения (реальный пробел,
                найден пользователем 2026-07-22: та же подсказка уже была у
                Счётчиков, здесь её не было вовсе). */}
            {selectedAsset && selectedAsset.tariff && !selectedAsset.active && (
              <p className="mb-3 text-caption-airbnb text-muted-foreground">{t.operatorApp.gameRoom.assetInactiveHint}</p>
            )}

            {selectedAsset && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
                {selectedLaunches.map((l) => {
                  const expired = isExpired(l);
                  const nearExpiry = isNearExpiry(l);
                  const elapsedMs = now.getTime() - new Date(l.startedAt).getTime();
                  const liveAmount = estimateLiveAmount(
                    l.pricingMode,
                    l.priceSnapshot,
                    l.roundingModeSnapshot,
                    l.minAmountSnapshot,
                    new Date(l.startedAt),
                    now,
                    selectedZone?.amountRoundingEnabled ?? false
                  );
                  const timeText =
                    l.pricingMode === "fixed" && l.durationMinutesSnapshot != null
                      ? formatMMSS(l.durationMinutesSnapshot * 60000 - elapsedMs)
                      : formatMMSS(elapsedMs);
                  // Пуск "заморожен" (запрос пользователя 2026-07-27) — ждёт
                  // способ оплаты, endedAt/amount уже зафиксированы сервером
                  // (см. lockLaunch). Тайл целиком превращается в кнопку
                  // "Возобновить" — серый + крупная иконка play, тот же приём,
                  // что у деактивированных зон/активов (grayscale). Открыть
                  // шторку оплаты заново с ЭТОГО экрана нельзя — только тап
                  // "Возобновить" (снимает заморозку, пуск снова идёт) и затем
                  // повторное "Точно?"/lockLaunch (аудит 2026-07-27, второй
                  // раунд: комментарий здесь раньше утверждал, что шторка
                  // "открывается сама при следующем заходе на экран" — такого
                  // эффекта в коде не существует, был неточным).
                  if (!l.isOpen) {
                    return (
                      <PressableScale key={l.id}>
                        <button
                          type="button"
                          aria-label={t.operatorApp.gameRoom.resumeLaunchAction}
                          disabled={resuming === l.id}
                          onClick={() => resumeLaunch(l.id)}
                          className="flex aspect-4/5 w-full grayscale flex-col items-center justify-center gap-1 rounded-card border-[1.5px] border-border bg-card p-2 text-center shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] disabled:opacity-60"
                        >
                          <span className="flex flex-col items-center leading-tight">
                            <span className="text-[0.625rem] font-semibold text-muted-foreground">
                              {t.operatorApp.gameRoom.wristbandNumberPrefix}
                            </span>
                            <span className="text-sm font-extrabold tabular-nums">{l.number}</span>
                          </span>
                          <Play className="size-9 text-muted-foreground" fill="currentColor" />
                          {l.amount != null && (
                            <Money value={l.amount} className="text-sm font-semibold text-muted-foreground" />
                          )}
                        </button>
                      </PressableScale>
                    );
                  }

                  // "Точно?" — инлайн в тайле (запрос пользователя 2026-07-17).
                  // Способ оплаты "По факту" дальше уходит в отдельный bottom
                  // sheet (запрос того же дня), не остаётся в тайле.
                  if (interacting === l.id) {
                    return (
                      <div
                        key={l.id}
                        className="flex aspect-4/5 w-full flex-col items-center justify-center gap-2 rounded-card border-[1.5px] border-primary bg-card p-2 text-center shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]"
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
                              onClick={(e) => {
                                setInteracting(null);
                                // ВСЕГДА lockLaunch для per_minute, не
                                // "liveAmount > 0 ? lock : закрыть бесплатно
                                // напрямую" (аудит 2026-07-27, второй раунд,
                                // реальный денежный баг): liveAmount —
                                // клиентская ОЦЕНКА (estimateLiveAmount,
                                // локальный таймер устройства), а не то, что
                                // реально посчитает сервер. При округлении
                                // "вниз"/"к ближайшему" она читается ровно 0
                                // первые ~30-60с пуска — если между тапом
                                // оператора и обработкой на сервере реальное
                                // время пересекло границу тарификации,
                                // сервер посчитал бы РЕАЛЬНУЮ ненулевую сумму,
                                // а старый код уже отправил бы stopLaunch с
                                // paymentMethod="cash" НАПРЯМУЮ, без единого
                                // подтверждения — непроверенный платёж наличными
                                // проводился молча. lockLaunch всегда спрашивает
                                // сервер за реальной суммой и открывает шторку
                                // (см. stopPaymentTarget.amount === 0 ниже —
                                // тот же однокнопочный "Закрыть бесплатно",
                                // что и раньше, просто основан на подтверждённой
                                // сервером сумме, а не на клиентской догадке).
                                if (l.pricingMode === "per_minute") {
                                  lockLaunch(l);
                                } else {
                                  // Улетающая галочка (реальный баг, найден
                                  // пользователем 2026-07-20: "у 'За вход'
                                  // при закрытии галочка не вылетает") — у
                                  // "По факту" её шлёт ConfirmButton в
                                  // stopPaymentTarget-шторке, а этот путь
                                  // ("За вход", без выбора оплаты, и "По
                                  // факту" с суммой 0) — обычная <button>,
                                  // событие не отправляла бы сама.
                                  // silent: true — звук уже играет
                                  // playCloseChime() внутри stopLaunch().
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  window.dispatchEvent(
                                    new CustomEvent("save-success-fly", {
                                      detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, silent: true },
                                    })
                                  );
                                  // pricingMode здесь всегда "fixed" ("За
                                  // вход") — per_minute теперь всегда уходит
                                  // в lockLaunch выше, эта ветка для него
                                  // больше не достижима.
                                  stopLaunch(l.id, undefined);
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
                    // @container — размеры текста внутри тайла считаются от
                    // ШИРИНЫ САМОГО ТАЙЛА (cqw), а не от ширины экрана
                    // (реальный баг, найден пользователем 2026-08-22, живой
                    // скриншот: "27:49" распирало тайл до самых краёв).
                    // Сетка тут auto-fill minmax(5.5rem,1fr) — на широком
                    // экране растёт КОЛИЧЕСТВО колонок, а сами тайлы остаются
                    // почти теми же; прежние sm:/md: брейкпоинты вьюпорта
                    // при этом честно увеличивали шрифт — таймер перерастал
                    // тайл. Container query — единственная величина, которая
                    // здесь совпадает с реальной геометрией.
                    <div key={l.id} className="@container relative">
                      <PressableScale>
                        <button
                          type="button"
                          onClick={() => setInteracting(l.id)}
                          className={cn(
                            "relative flex aspect-4/5 w-full flex-col items-center gap-1 overflow-hidden rounded-card border-[1.5px] bg-card px-2 pb-2 text-center shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]",
                            // Запас сверху под бейдж привязки клиента (реальный
                            // баг, запрос пользователя 2026-07-27, живой
                            // скриншот: "Посетитель" наезжал на иконку) —
                            // отвязываем текст от геометрии бейджа через
                            // гарантированный отступ, а не подгонкой размера
                            // шрифта/центрирования. justify-start (не center)
                            // — контент сразу после отступа, а не по центру
                            // оставшегося места (запрос того же дня: "подними
                            // чуть выше").
                            clientsEnabled ? "justify-start pt-8" : "justify-center pt-2",
                            // Мигает только сам таймер, не весь тайл (запрос
                            // пользователя 2026-07-28: "не весь тайл, только
                            // сам таймер") — рамка просто меняет цвет, и уже
                            // за 30 секунд до истечения, не только после.
                            expired || nearExpiry ? "border-destructive" : "border-primary"
                          )}
                        >
                          {/* Цветовая метка — статичный цвет по номеру
                              посетителя (запрос пользователя 2026-07-27), не
                              случайный: та же фиксированная палитра, что у
                              меток Оператора/Актива (COLOR_TAG_PALETTE),
                              зациклена по номеру — у одного и того же номера
                              всегда один и тот же цвет. Высота (h-7=28px) —
                              не ниже границы фона бейджа привязки клиента
                              (size-9 на -top-2, нижний край на 28px от верха
                              тайла) — запрос того же дня. Без текста внутри —
                              "Посетитель" на прежнем месте ниже, как и было. */}
                          {clientsEnabled && (
                            <span
                              className="absolute inset-x-0 top-0 h-5.75 rounded-t-card"
                              style={{ backgroundColor: COLOR_TAG_PALETTE[(l.number - 1) % COLOR_TAG_PALETTE.length] }}
                            />
                          )}
                          {/* Название и номер в 2 строки, номер крупнее
                              (запрос пользователя 2026-07-27) — в одну
                              строку текст "Посетитель N" залезал на
                              бейдж привязки клиента в углу тайла. */}
                          <span className="flex flex-col items-center leading-tight">
                            {/* clamp(...,cqw,...) — нижняя граница держит
                                прежний размер на телефоне (там 8cqw заведомо
                                меньше 0.625rem), верхняя не даёт подписи
                                разрастись на широком тайле планшета. */}
                            <span className="text-[clamp(0.625rem,8cqw,0.875rem)] font-semibold text-muted-foreground">
                              {t.operatorApp.gameRoom.wristbandNumberPrefix}
                            </span>
                            <span className="text-[clamp(0.875rem,11cqw,1.25rem)] font-extrabold tabular-nums">
                              {l.number}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "tabular-nums",
                              // Размер — от ширины ТАЙЛА (cqw, см. @container
                              // на обёртке выше), не от вьюпорта. Прежние
                              // sm:/md: (правка 2026-07-29) исходили из того,
                              // что на широком экране растут сами тайлы — а
                              // растёт число колонок: на десктопе тайл
                              // оставался ~105px, а шрифт уходил в text-4xl
                              // (36px), и "27:49" (~2.8em у Inter с
                              // tabular-nums) переставало помещаться в
                              // ширину за вычетом px-2 (реальный баг,
                              // пользователь 2026-08-22, живой скриншот).
                              // 26cqw — с запасом: даже на минимальном тайле
                              // 5.5rem строка занимает ~88% доступной ширины.
                              l.pricingMode === "fixed"
                                ? cn(
                                    // leading-none — у арбитрарного text-[...]
                                    // Tailwind не проставляет line-height (в
                                    // отличие от text-2xl/3xl/4xl), иначе
                                    // строка унаследовала бы 1.5 от html и
                                    // выросла бы по высоте в тайле.
                                    "text-[clamp(1.25rem,26cqw,2.5rem)] font-extrabold leading-none",
                                    (expired || nearExpiry) && "text-destructive motion-safe:animate-pulse"
                                  )
                                : // Крупнее и жирнее (реальный баг, найден
                                  // пользователем 2026-07-29: "таймер очень
                                  // маленький на мобильном, должен быть
                                  // заметнее") — text-sm/muted читался как
                                  // второстепенная подпись, хотя это
                                  // рабочее время посетителя. Меньше суммы
                                  // ниже — сумма остаётся главным акцентом
                                  // тайла, но сам таймер теперь читается с
                                  // одного взгляда.
                                  "text-[clamp(1rem,18cqw,1.75rem)] font-extrabold leading-none"
                            )}
                          >
                            {/* "Время вышло" не влезал в узкий тайл браслета
                                (реальный баг, найден пользователем
                                2026-07-28) — просто "00:00" (formatMMSS сам
                                клампит отрицательное в 0), сигнал уже даёт
                                пульсирующая красная рамка тайла (см. выше). */}
                            {timeText}
                          </span>
                          {l.pricingMode === "per_minute" && (
                            // size="display" — сумма растёт со временем ("По
                            // факту", руб/мин), в маленьком квадратном тайле
                            // 3+ значные суммы с копейками не влезали бы при
                            // фиксированном text-2xl (запрос пользователя
                            // 2026-07-26, живой скриншот). Тот же механизм
                            // авто-уменьшения, что уже на Отчётах/Главной.
                            // Акцентный цвет суммы — запрос пользователя
                            // 2026-07-27.
                            //
                            // Дефолтный порог computeMoneyDisplayScale
                            // (thresholdLength=6) калиброван под крупные
                            // заголовки в 1-2 широкие колонки (см. комментарий
                            // в money.tsx) — тут узкий тайл (3 в ряд), и
                            // дефолт вообще не срабатывал на короткие
                            // 1-2-значные суммы ("17", "6" — 1-2 символа,
                            // ниже порога). Но сам displayScale считается
                            // ТОЛЬКО от длины строки, не от реальной ширины
                            // контейнера (money.tsx это не измеряет) —
                            // поэтому даже с более ранним порогом короткое
                            // "17" на действительно узком экране (реальный
                            // баг, пользователь 2026-07-29: "на некоторых
                            // устройствах где разрешение меньше сумма не
                            // вмещается") всё равно не сжалось бы. База
                            // уменьшена text-2xl → text-xl на мобильном
                            // (гарантированно меньше на ЛЮБОМ телефоне, не
                            // только на длинных суммах), threshold ниже — на
                            // случай, если сумма всё же дорастёт до 3+
                            // знаков за время посещения. Базовый размер —
                            // в cqw от ширины тайла (как у таймера выше),
                            // а displayScale поверх него ужимает длинные
                            // суммы.
                            //
                            // font-size стоит на ОБЁРТКЕ, а не на самом
                            // <Money> (реальный баг, найден 2026-08-22 при
                            // разборе масштабирования): при size="display"
                            // Money всегда ставит инлайновый
                            // style={{fontSize: `${displayScale}em`}} — а
                            // инлайн-стиль перебивает класс, и `em` в
                            // font-size считается от РОДИТЕЛЯ, поэтому
                            // text-xl/sm:/md: прямо на Money не действовали
                            // вообще: сумма рисовалась унаследованным
                            // размером кнопки. Остальные вызовы
                            // size="display" в проекте так и сделаны —
                            // размер на внешнем <span> (см. operator/page.tsx).
                            <span className="text-[clamp(1rem,22cqw,2rem)] font-extrabold leading-none text-primary">
                              <Money
                                value={liveAmount}
                                size="display"
                                displayScale={computeMoneyDisplayScale(formatMoney(liveAmount, locale).length, {
                                  // Плашка узкая, но прежние пороги ужимали
                                  // сумму до предела уже на 12 000 ₽ (правка
                                  // владельца 2026-08-17).
                                  thresholdLength: 5,
                                  perCharReduction: 0.09,
                                  minScale: 0.6,
                                })}
                              />
                            </span>
                          )}
                        </button>
                      </PressableScale>
                      {/* "Чей это ребёнок" (запрос пользователя 2026-07-27) —
                          значок торчит за угол тайла (-right-2 -top-2), тот
                          же приём, что у степпера списания с баланса и
                          бейджа количества в корзине по всему проекту (не
                          "внутри" угла, как было раньше). Отдельный
                          <button>, не вложенный в тайл-<button> выше — сидит
                          сверху как самостоятельный элемент, не всплывает
                          клик на сам тайл. */}
                      {clientsEnabled && (
                        <PressableScale className="absolute -right-2 -top-2 z-10">
                          <button
                            type="button"
                            aria-label={t.operatorApp.gameRoom.linkClientAction}
                            onClick={(e) => {
                              e.stopPropagation();
                              setLinkClientTarget(l);
                            }}
                            className={cn(
                              "flex size-9 items-center justify-center rounded-full shadow-md",
                              // Серый — не привязан, акцентный — привязан
                              // (запрос пользователя 2026-07-27) — цвет сам
                              // по себе уже говорит о статусе. Заливка
                              // "currentColor" на самой иконке убрана (тот
                              // же день, скриншот) — на size-4 Wallet-иконка
                              // с fill превращалась в нечитаемое пятно.
                              l.linkedClient
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <Wallet className="size-4" />
                          </button>
                        </PressableScale>
                      )}
                    </div>
                  );
                })}

                <PressableScale>
                  <button
                    type="button"
                    onClick={handleAddTap}
                    disabled={addDisabled}
                    className="flex aspect-4/5 w-full flex-col items-center justify-center gap-1 rounded-card border-[1.5px] border-dashed border-border p-2 text-center text-muted-foreground shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] disabled:opacity-40"
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
                    <span>{opt.name ?? `${opt.durationMinutes} ${t.operatorApp.workTime.minutesShort}`}</span>
                    <Money value={opt.price} />
                  </Button>
                </PressableScale>
              ))}
            </div>
          </div>
        )}
        {addFlow?.stage === "rate" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.pickRateTitle}</h2>
            <div className="flex flex-col gap-2">
              {selectedRateOptions.map((opt) => (
                <PressableScale key={opt.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-between font-semibold"
                    disabled={starting}
                    onClick={() => startLaunch(opt.id)}
                  >
                    <span>{opt.name}</span>
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
                silent
                onConfirm={() => startLaunch(addFlow.optionId, "cash")}
              >
                <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.cashLabel}
              </ConfirmButton>
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={starting}
                silent
                onConfirm={() => startLaunch(addFlow.optionId, "mobile")}
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
              )}
            </div>
            <PressableScale className="w-fit">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto gap-1 px-0 text-muted-foreground underline underline-offset-2"
                onClick={() => {
                  const amount = selectedOptions.find((o) => o.id === addFlow.optionId)?.price ?? 0;
                  setSplitStartTarget({ optionId: addFlow.optionId, amount });
                  setAddFlow(null);
                }}
              >
                <ArrowLeftRight className="size-3.5" />
                {t.splitPayment.title}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <SplitPaymentSheet
        open={splitStartTarget !== null}
        onClose={() => setSplitStartTarget(null)}
        total={splitStartTarget?.amount ?? 0}
        allowedMethods={LAUNCH_SPLIT_METHODS}
        clientsEnabled={clientsEnabled}
        submitting={starting}
        onSubmit={(legs) => startLaunch(splitStartTarget?.optionId, "cash", undefined, legs)}
      />

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
              <Money value={stopPaymentTarget.amount ?? 0} />
            </p>
            {/* Сумма 0 сюда больше не попадает — lockLaunch() закрывает такой
                пуск сразу, минуя эту шторку целиком (см. комментарий там). */}
            <div className="flex flex-col gap-2">
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={stopping}
                silent
                onConfirm={() => stopLaunch(stopPaymentTarget.id, "cash")}
              >
                <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.cashLabel}
              </ConfirmButton>
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={stopping}
                silent
                onConfirm={() => stopLaunch(stopPaymentTarget.id, "mobile")}
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
                    disabled={stopping}
                    onClick={() => {
                      const launch = stopPaymentTarget;
                      setStopPaymentTarget(null);
                      setAbonementTarget({ kind: "stop", launch, amount: launch.amount ?? 0 });
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
                  const launch = stopPaymentTarget;
                  setStopPaymentTarget(null);
                  setSplitStopTarget({ launch });
                }}
              >
                <ArrowLeftRight className="size-3.5" />
                {t.splitPayment.title}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <SplitPaymentSheet
        open={splitStopTarget !== null}
        onClose={() => setSplitStopTarget(null)}
        total={splitStopTarget ? (splitStopTarget.launch.amount ?? 0) : 0}
        allowedMethods={LAUNCH_SPLIT_METHODS}
        clientsEnabled={clientsEnabled}
        submitting={stopping}
        onSubmit={(legs) => (splitStopTarget ? stopLaunch(splitStopTarget.launch.id, "cash", undefined, legs) : undefined)}
      />

      <AbonementPaymentSheet
        open={abonementTarget !== null}
        onClose={() => setAbonementTarget(null)}
        amount={abonementTarget?.amount ?? 0}
        silent
        onConfirm={(walletId) => {
          if (!abonementTarget) return undefined;
          // return — иначе ConfirmButton (аудит 2026-07-24, найдено
          // само-ревью моей же предыдущей правки) не получает промис для
          // ожидания и играет галочку "успех" сразу по тапу, до реального
          // списания с баланса.
          return abonementTarget.kind === "start"
            ? startLaunch(abonementTarget.optionId, "abonement", walletId)
            : stopLaunch(abonementTarget.launch.id, "abonement", walletId);
        }}
      />

      <LinkClientSheet
        open={linkClientTarget !== null}
        onClose={() => setLinkClientTarget(null)}
        endpoint={linkClientTarget ? `/api/launches/${linkClientTarget.id}/link-client` : null}
        current={linkClientTarget?.linkedClient ?? null}
        onLinked={() => {
          setLinkClientTarget(null);
          loadLaunches(selectedZoneId);
        }}
        onUnlinked={() => {
          setLinkClientTarget(null);
          loadLaunches(selectedZoneId);
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
      <ActionToast message={errorToast.message} variant={errorToast.variant} />
    </div>
  );
}
