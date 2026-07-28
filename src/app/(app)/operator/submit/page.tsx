"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Home, MapPin, RefreshCcw, Send, TriangleAlert } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { PaymentMethodIcon } from "@/components/payment-method-icon";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ImageLightbox } from "@/components/motion/image-lightbox";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import {
  calcSessions,
  calcZoneGrossRevenue,
  calcZoneRevenue,
  isCountersTapAssistZone,
  isLaunchesZone,
  isStaysZone,
  isTicketsZone,
  type ZoneAccountingMode,
} from "@/lib/results-calc";
import { queueSubmission } from "@/lib/offline-submissions";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { PrintButton } from "@/components/print/print-button";
import { ActionToast } from "@/components/action-toast";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useActionToast } from "@/hooks/use-action-toast";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import { playErrorChime } from "@/lib/beep";
import type { PrintDocumentData, PrintSection } from "@/lib/print/receipt-document";
import { formatMoneyWithCurrency, parseMoneyInput } from "@/lib/format";
import { formatTime } from "@/lib/datetime-format";
import { cn, colorTagGradient } from "@/lib/utils";

interface TariffCtx {
  id: string;
  name: string;
  price: string;
  order: number;
}
interface AssetCtx {
  id: string;
  name: string;
  colorTag: string;
  photoUrl: string | null;
  iconKey: string | null;
  // Актив на ремонте (запрос пользователя 2026-07-16) — в отличие от зоны,
  // не скрывается: оператор видит его, но не может ввести новое показание,
  // поле read-only с последним известным значением (см. isAssetFilled,
  // сама форма ниже).
  active: boolean;
  previousReadings: Record<string, number>;
}
interface ZoneCtx {
  id: string;
  name: string;
  iconKey: string | null;
  accountingMode: ZoneAccountingMode;
  // Показания по тапам вместо ручного ввода (запрос пользователя 2026-07-25) —
  // см. isCountersTapAssistZone в results-calc.ts.
  countersTapAssistEnabled: boolean;
  tariffs: TariffCtx[];
  assets: AssetCtx[];
}

interface ZoneFormState {
  returnsCount: string;
  // Для "Прибываний" — сумма всех assetCash ниже (запрос пользователя
  // 2026-07-17: "Активы по аналогии, как и со счётчиками" — реальные суммы
  // вносятся по каждому активу, а не одной строкой на зону); для остальных
  // режимов — как раньше, вводится напрямую.
  cashAmount: string;
  mobileAmount: string;
  readings: Record<string, string>; // key: `${assetId}:${tariffId}`
  // Только "Прибывания" — реальные Наличные/Безнал по каждому активу,
  // ключ assetId. cashAmount/mobileAmount выше пересчитываются их суммой.
  assetCash: Record<string, { cash: string; mobile: string }>;
  // Какие активы "Прибываний"/"Пусков" сотрудник уже подтвердил кнопкой
  // "Сохранить" в sheet'е (запрос пользователя 2026-07-18) — ОТДЕЛЬНО от
  // assetCash: если оба поля оставлены пустыми (никого не было, 0/0), это
  // ВСЁ РАВНО должно засчитываться как заполненный/подтверждённый актив, а
  // не выглядеть как "ещё не тронутый" — иначе значения "никого не было"
  // нигде не запоминаются как осознанное решение сотрудника.
  confirmedAssetIds: string[];
}

// Расход, уже зафиксированный через экран "Расходы" за текущий период зоны
// (запрос пользователя 2026-07-25: "чтобы не надо было запоминать до конца
// смены") — тот же принцип, что и Возвраты: шаг сдачи итогов только
// показывает read-only, вводить здесь больше нельзя.
interface ExpenseEventCtx {
  id: string;
  amount: number;
  categoryName: string | null;
  comment: string | null;
  createdAt: string;
}

type Step = { kind: "select" } | { kind: "zone"; zoneId: string } | { kind: "expenses" } | { kind: "review" };

export default function SubmitResultsPage() {
  const router = useRouter();
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();
  const printAvailable = useOperatorPrintAvailable();
  const [loading, setLoading] = useState(true);
  const [zones, setZones] = useState<ZoneCtx[]>([]);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [zoneForms, setZoneForms] = useState<Record<string, ZoneFormState>>({});
  const [expenseEventsByZone, setExpenseEventsByZone] = useState<Record<string, ExpenseEventCtx[]>>({});
  const [stepIndex, setStepIndex] = useState(0);
  // Общий sheet-по-активу: показания счётчика/пуска (counters/launches) или
  // реальная касса "Прибываний" (запрос пользователя 2026-07-17) — режимы
  // взаимоисключающие для одной зоны, поэтому один и тот же id обслуживает
  // оба случая, ветвление по activeZone.accountingMode внутри самого sheet.
  const [assetSheetId, setAssetSheetId] = useState<string | null>(null);
  // Галочка при сохранении показания/кассы актива — тот же приём, что у
  // SaveButton по всему проекту (запрос пользователя 2026-07-18: "должна
  // вылетать галочка, это верно для абсолютно всех кнопок Сохранить"), тут
  // раньше просто закрывал sheet без анимации.
  const { saved: assetSheetSaved, pulse: pulseAssetSheet } = useSavePulse();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const errorToast = useActionToast();
  const [queued, setQueued] = useState(false);
  // Мягкая блокировка сдачи для "Прибываний" (docs/spec/04-game-room.md) —
  // сколько пусков ещё открыто, по каждому АКТИВУ отдельно (запрос
  // пользователя 2026-07-17: "не по отношению к Зоне, а к Активу с
  // переходом на Актуальный Актив") — зона может держать несколько активов,
  // сообщение и переход должны вести сразу к нужному, а не к зоне вообще.
  const [gameRoomOpenByAsset, setGameRoomOpenByAsset] = useState<{ assetId: string; count: number }[]>([]);
  // Расчётная выручка "Прибываний" по каждому активу отдельно (запрос
  // пользователя 2026-07-17: "внутри актива... сумма расчётная как read
  // only, сотрудник вносит реальные суммы — так мы узнаем есть ли
  // разница") — cashAmount/mobileAmount тут лишь справочные (по данным
  // выбранного способа оплаты браслетов), настоящая реальная сумма — в
  // activeForm.assetCash, вводится сотрудником вручную.
  const [gameRoomRevenueByAsset, setGameRoomRevenueByAsset] = useState<
    { assetId: string; calculatedAmount: number; cashAmount: number; mobileAmount: number; abonementAmount: number }[]
  >([]);
  // Билеты (docs/spec/10-tickets.md) — расчётная выручка ОДНОЙ парой на
  // зону, не по активам (заказ мультиактивный) — тот же принцип получения
  // (fetch при входе на шаг зоны), что у gameRoomRevenueByAsset выше, просто
  // агрегат зонный, не по активам. ПО ЗОНЕ (не одно значение "текущей" зоны) —
  // реальный баг, найден пользователем 2026-07-21: на шаге "Проверьте перед
  // отправкой" расчётная выручка Билетов показывала 0₽, хотя на шаге ввода
  // кассы только что верно посчиталась — предыдущая версия сбрасывала это
  // значение в null при уходе С шага зоны, а previewFor() (используется на
  // шаге "Проверка") вообще не знал о билетах и всегда считал по tariffCalc
  // (у Билетов zone.tariffs всегда пуст → 0). Копится по всем зонам сдачи,
  // не сбрасывается при переходе между шагами.
  const [ticketsAggregateByZone, setTicketsAggregateByZone] = useState<
    Record<string, { totalAmount: number; cashAmount: number; mobileAmount: number; abonementAmount: number }>
  >({});
  // "Счётчики"/"Только касса" — сумма, оплаченная с баланса клиента с
  // момента предыдущей сдачи (реальный баг, найден пользователем 2026-07-24:
  // "Разница" на сервере уже её учитывала — actualCash + abonementAmount -
  // netRevenue, — а живой предпросмотр здесь нет, сотрудник видел один
  // расчёт при вводе кассы и другой после отправки). Тот же принцип
  // накопления, что у ticketsAggregateByZone выше — нужен ещё и на шаге
  // "Проверьте перед отправкой".
  const [counterAbonementByZone, setCounterAbonementByZone] = useState<Record<string, number>>({});
  // Расчётная разбивка Наличные/Безнал по тапам с указанным способом оплаты
  // (запрос пользователя 2026-07-25: "не видно сколько по наличному и
  // безналичному") — только подсказка рядом с полями ввода, кассу это НЕ
  // заполняет автоматически (см. комментарий в counter-tap-events/route.ts).
  const [tapPaymentBreakdownByZone, setTapPaymentBreakdownByZone] = useState<
    Record<string, { cashAmount: number; mobileAmount: number; abonementAmount: number }>
  >({});
  // Возвраты/тесты tap-зон по ТАРИФУ (ключ `${zoneId}:${tariffId}`) — реальный
  // баг, найден пользователем 2026-07-25: живой предпросмотр здесь считал
  // "Разницу" по старой формуле calcZoneRevenue(tariffCalc, form.returnsCount),
  // а form.returnsCount для tap-зон всегда 0 (источник теперь voidedAt на
  // конкретном тапе, не общий счётчик зоны — /api/operator/zone-return-events
  // больше не отдаёт tap-зоны вовсе), поэтому превью НИКОГДА не учитывало
  // возвраты и показывало Разницу большей, чем при реальной отправке
  // (submit-results/route.ts уже считает точно, по voidedCountByZoneTariff) —
  // здесь то же самое, чтобы предпросмотр не расходился с тем, что реально
  // отправится.
  const [voidedCountByZoneTariff, setVoidedCountByZoneTariff] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{
    summary: {
      zoneId: string;
      zoneName: string;
      calculatedRevenue: number;
      actualCash: number;
      difference: number;
      abonementAmount: number;
    }[];
    remindMarkDeparture?: boolean;
  } | null>(null);
  // Возвраты/тестовые пуски (docs/spec/01-counters.md, п.3) — раньше
  // вводились тут же "из головы" (запрос пользователя 2026-07-24: "надо
  // запоминать" — теперь каждый факт фиксируется заранее через пункт
  // нижнего бара "Счётчики", это поле только показывает уже накопленное за
  // текущий период зоны, менять его тут больше нельзя ("раз не внёс, то
  // проехали" — решение того же дня).
  const [returnCountsByZone, setReturnCountsByZone] = useState<Record<string, number>>({});
  // Настройки → Система → "Расходы" (запрос пользователя 2026-07-25) — если
  // Владелец выключил тумблер, шаг "Расходы" не показываем вовсе (внести
  // расход и так неоткуда было — экран/API уже недоступны).
  const [expensesEnabled, setExpensesEnabled] = useState(true);

  useEffect(() => {
    fetch("/api/operator/submission-context")
      .then(async (res) => {
        if (!res.ok) {
          router.replace("/operator/login");
          return;
        }
        const data = await res.json();
        setZones(data.zones ?? []);
        setExpensesEnabled(data.expensesEnabled !== false);
        setLoading(false);
      });
    fetch("/api/operator/zone-return-events")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const counts: Record<string, number> = {};
        for (const e of data?.events ?? []) counts[e.zoneId] = (counts[e.zoneId] ?? 0) + 1;
        setReturnCountsByZone(counts);
      })
      .catch(() => {});
    // Расходы, уже внесённые через экран "Расходы" за текущий период (запрос
    // пользователя 2026-07-25) — та же логика, что у Возвратов выше.
    fetch("/api/operator/zone-expense-events")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const byZone: Record<string, ExpenseEventCtx[]> = {};
        for (const e of data?.events ?? []) {
          (byZone[e.zoneId] ??= []).push({
            id: e.id,
            amount: e.amount,
            categoryName: e.categoryName,
            comment: e.comment,
            createdAt: e.createdAt,
          });
        }
        setExpenseEventsByZone(byZone);
      })
      .catch(() => {});
  }, [router]);

  // Шаг "Расходы" — только если за текущий период есть хоть одна запись
  // хотя бы по одной из сдаваемых зон (запрос пользователя 2026-07-25:
  // "если расходов нет... то и нет смысла показывать этот экран") — иначе
  // это пустой экран с одним "Расходов пока нет.", ничего не даёт оператору.
  const hasExpensesToShow = selectedZoneIds.some((zoneId) => (expenseEventsByZone[zoneId] ?? []).length > 0);

  const steps: Step[] = useMemo(() => {
    const list: Step[] = [{ kind: "select" }];
    for (const zoneId of selectedZoneIds) list.push({ kind: "zone", zoneId });
    if (selectedZoneIds.length > 0) {
      if (expensesEnabled && hasExpensesToShow) list.push({ kind: "expenses" });
      list.push({ kind: "review" });
    }
    return list;
  }, [selectedZoneIds, expensesEnabled, hasExpensesToShow]);

  const currentStep = steps[stepIndex] ?? steps[0];

  // Мягкая блокировка (docs/spec/04-game-room.md) — при входе на шаг зоны
  // "Прибываний" проверяем, не остались ли открытые пуски.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (currentStep.kind !== "zone") {
      setGameRoomOpenByAsset([]);
      setGameRoomRevenueByAsset([]);
      return;
    }
    const zone = zones.find((z) => z.id === currentStep.zoneId);
    setGameRoomOpenByAsset([]);
    setGameRoomRevenueByAsset([]);
    if (!zone) return;

    if (isTicketsZone(zone)) {
      // Копится в ticketsAggregateByZone (не сбрасывается при уходе с шага —
      // нужен ещё и на шаге "Проверьте перед отправкой", см. previewFor()).
      fetch(`/api/zones/${zone.id}/ticket-orders?aggregate=1`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.aggregate) {
            setTicketsAggregateByZone((prev) => ({ ...prev, [zone.id]: data.aggregate }));
          }
        });
      return;
    }

    if (isStaysZone(zone)) {
      fetch(`/api/zones/${zone.id}/launches?cashSplit=1`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const openCounts = new Map<string, number>();
          for (const l of data?.launches ?? []) {
            if (!l.assetId) continue;
            openCounts.set(l.assetId, (openCounts.get(l.assetId) ?? 0) + 1);
          }
          setGameRoomOpenByAsset(Array.from(openCounts, ([assetId, count]) => ({ assetId, count })));
          setGameRoomRevenueByAsset(data?.revenueByAsset ?? []);
        });
      return;
    }

    // "Пуски" — тот же per-asset расчёт read-only, что и "Прибывания" (запрос
    // пользователя 2026-07-17: "Да" на вопрос "сдача итогов тоже read-only
    // calculated"), но без открытых пусков — тап мгновенный, блокировки нет.
    if (isLaunchesZone(zone)) {
      fetch(`/api/zones/${zone.id}/tally`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setGameRoomRevenueByAsset(data?.revenueByAsset ?? []));
      return;
    }

    // "Счётчики" с тапами вместо ручного ввода (запрос пользователя
    // 2026-07-25) — показания не вводятся тут, тапы делаются заранее на
    // отдельном экране "Счётчики" (нижний бар), сюда только подтягиваем уже
    // накопленное и молча заполняем form.readings тем же ключом
    // `${assetId}:${tariffId}`, что использует ручной ввод — весь остальной
    // код (previewFor, isAssetFilled, handleSubmit) работает НЕ ЗНАЯ, что
    // источник другой, изменений там не требуется.
    if (isCountersTapAssistZone(zone)) {
      fetch("/api/operator/counter-tap-events")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const counts: { assetId: string; tariffId: string; count: number }[] = data?.counts ?? [];
          const countByKey = new Map(counts.map((c) => [`${c.assetId}:${c.tariffId}`, c.count]));
          const readings: Record<string, string> = {};
          for (const asset of zone.assets) {
            for (const tariff of zone.tariffs) {
              const key = `${asset.id}:${tariff.id}`;
              const previous = asset.previousReadings[tariff.id] ?? 0;
              const taps = countByKey.get(key) ?? 0;
              readings[key] = String((previous + taps) % 10000);
            }
          }
          setZoneForms((prev) => ({ ...prev, [zone.id]: { ...prev[zone.id], readings } }));
          const breakdown: { zoneId: string; cashAmount: number; mobileAmount: number; abonementAmount: number }[] =
            data?.paymentBreakdown ?? [];
          const own = breakdown.find((b) => b.zoneId === zone.id);
          if (own) {
            setTapPaymentBreakdownByZone((prev) => ({
              ...prev,
              [zone.id]: { cashAmount: own.cashAmount, mobileAmount: own.mobileAmount, abonementAmount: own.abonementAmount },
            }));
          }
          // Возвраты/тесты по тарифу (см. комментарий у voidedCountByZoneTariff
          // выше) — та же точная логика, что submit-results/route.ts
          // использует для НАСТОЯЩЕЙ отправки, тут только для превью.
          const recentTaps: { zoneId: string; tariffId: string; voidedAt: string | null }[] = data?.recentTaps ?? [];
          // Обнуляем ВСЕ тарифы этой зоны перед пересчётом — иначе тариф, у
          // которого пометку сняли (voidedAt → null), продолжал бы числиться
          // возвратом по старому значению из прошлого фетча (не пересоздаётся
          // ключ, которого больше нет во входных данных).
          const voidedByTariff: Record<string, number> = {};
          for (const tariff of zone.tariffs) voidedByTariff[`${zone.id}:${tariff.id}`] = 0;
          for (const tap of recentTaps) {
            if (tap.zoneId !== zone.id || !tap.voidedAt) continue;
            const key = `${tap.zoneId}:${tap.tariffId}`;
            voidedByTariff[key] = (voidedByTariff[key] ?? 0) + 1;
          }
          setVoidedCountByZoneTariff((prev) => ({ ...prev, ...voidedByTariff }));
        });
      // Без return — ниже ещё абонементная сумма (см. следующий блок), она
      // нужна tap-зонам точно так же, как обычным "Счётчикам".
    }

    // "Счётчики"/"Только касса" — сумма, оплаченная с баланса (см.
    // counterAbonementByZone выше). Копится по всем зонам сдачи, не
    // сбрасывается при уходе с шага — тот же принцип, что у Билетов.
    if (zone.accountingMode === "counters" || zone.accountingMode === "cash_only") {
      fetch(`/api/zones/${zone.id}/abonement-amount`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (typeof data?.amount === "number") {
            setCounterAbonementByZone((prev) => ({ ...prev, [zone.id]: data.amount }));
          }
        });
    }
  }, [currentStep, zones]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleZone(zoneId: string) {
    setSelectedZoneIds((prev) =>
      prev.includes(zoneId) ? prev.filter((id) => id !== zoneId) : [...prev, zoneId]
    );
    setZoneForms((prev) => {
      if (prev[zoneId]) return prev;
      return {
        ...prev,
        [zoneId]: {
          returnsCount: String(returnCountsByZone[zoneId] ?? 0),
          cashAmount: "",
          mobileAmount: "",
          readings: {},
          assetCash: {},
          confirmedAssetIds: [],
        },
      };
    });
  }

  // Отметка "актив подтверждён" (запрос пользователя 2026-07-18) — вызывается
  // при нажатии "Сохранить" в sheet'е "Прибываний"/"Пусков", даже если оба
  // поля остались пустыми (0/0 — тоже осознанное решение, не "не заполнено").
  function confirmAssetCash(zoneId: string, assetId: string) {
    setZoneForms((prev) => {
      const form = prev[zoneId];
      if (form.confirmedAssetIds.includes(assetId)) return prev;
      return { ...prev, [zoneId]: { ...form, confirmedAssetIds: [...form.confirmedAssetIds, assetId] } };
    });
  }

  function updateZoneField(zoneId: string, field: keyof Omit<ZoneFormState, "readings" | "assetCash">, value: string) {
    setZoneForms((prev) => ({ ...prev, [zoneId]: { ...prev[zoneId], [field]: value } }));
  }

  function updateReading(zoneId: string, key: string, value: string) {
    setZoneForms((prev) => ({
      ...prev,
      [zoneId]: { ...prev[zoneId], readings: { ...prev[zoneId].readings, [key]: value } },
    }));
  }

  // Реальная сумма Наличные/Безнал по активу "Прибываний" (запрос
  // пользователя 2026-07-17) — cashAmount/mobileAmount зоны пересчитываются
  // суммой сразу же, остальной код (предпросмотр, отправка формы) продолжает
  // читать их как раньше, ничего больше менять не нужно.
  function updateAssetCash(zoneId: string, assetId: string, field: "cash" | "mobile", value: string) {
    setZoneForms((prev) => {
      const form = prev[zoneId];
      const entry = form.assetCash[assetId] ?? { cash: "", mobile: "" };
      const assetCash = { ...form.assetCash, [assetId]: { ...entry, [field]: value } };
      const sum = (key: "cash" | "mobile") =>
        String(Object.values(assetCash).reduce((total, e) => total + parseMoneyInput(e[key]), 0));
      return {
        ...prev,
        [zoneId]: { ...form, assetCash, cashAmount: sum("cash"), mobileAmount: sum("mobile") },
      };
    });
  }

  function handlePhotoPressStart(url: string) {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setLightboxUrl(url);
    }, 350);
  }

  function handlePhotoPressEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    setLightboxUrl(null);
  }

  function handlePhotoClick(event: React.MouseEvent) {
    if (longPressFired.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressFired.current = false;
    }
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // Тариф, который оператор не тронул (или очистил) на конкретном активе —
  // не блокер: считаем показание неизменным (заездов 0 по этому тарифу), а
  // не буквальным нулём на счётчике (иначе гигантский "переход через 9999" —
  // фидбек пользователя 2026-07-09). Пустая строка и отсутствие ключа
  // трактуются одинаково.
  function resolveReading(raw: string | undefined, previous: number): number {
    if (raw === undefined || raw === "") return previous;
    return Number(raw);
  }

  function previewFor(zoneId: string) {
    const zone = zones.find((z) => z.id === zoneId);
    const form = zoneForms[zoneId];
    if (!zone || !form) return null;

    // Билеты — расчёт из серверного агрегата (ticketsAggregateByZone, заказы
    // с момента предыдущей сдачи), не из tariffCalc ниже — та формула только
    // для тарифов/показаний counters-подобных зон, у Билетов zone.tariffs
    // всегда пуст (реальный баг, найден пользователем 2026-07-21: "Проверьте
    // перед отправкой" показывал 0₽ вместо верной суммы с шага ввода кассы).
    if (isTicketsZone(zone)) {
      const agg = ticketsAggregateByZone[zoneId];
      const calculatedRevenue = agg?.totalAmount ?? 0;
      const abonementAmount = agg?.abonementAmount ?? 0;
      const actualCash = parseMoneyInput(form.cashAmount) + parseMoneyInput(form.mobileAmount);
      const difference = Math.round((actualCash + abonementAmount - calculatedRevenue) * 100) / 100;
      return { calculatedRevenue, netRevenue: calculatedRevenue, actualCash, difference, abonementAmount };
    }

    const tariffCalc = zone.tariffs.map((tariff) => {
      const sessions = zone.assets.reduce((sum, asset) => {
        const key = `${asset.id}:${tariff.id}`;
        const previous = asset.previousReadings[tariff.id] ?? 0;
        const current = resolveReading(form.readings[key], previous);
        if (zone.accountingMode === "launches") return sum + current;
        return sum + calcSessions(current, previous);
      }, 0);
      return { tariffId: tariff.id, price: Number(tariff.price), sessions };
    });

    // "Счёт." — всегда валовая выручка по счётчикам, ФАКТ (запрос пользователя
    // 2026-07-16). Разница считается от net (за вычетом тестов) — это
    // остаётся тем числом, по которому оператор/владелец решает "сошлось".
    const calculatedRevenue = calcZoneGrossRevenue(tariffCalc);
    // Tap-зоны — точный вычет ПО ТАРИФУ из voidedCountByZoneTariff, та же
    // логика, что submit-results/route.ts использует для настоящей отправки
    // (см. комментарий у voidedCountByZoneTariff выше — form.returnsCount для
    // tap-зон всегда 0, доверять ему тут больше нельзя).
    const netRevenue = isCountersTapAssistZone(zone)
      ? calcZoneGrossRevenue(
          tariffCalc.map((tc) => ({
            ...tc,
            sessions: Math.max(tc.sessions - (voidedCountByZoneTariff[`${zoneId}:${tc.tariffId}`] ?? 0), 0),
          }))
        )
      : calcZoneRevenue(tariffCalc, Number(form.returnsCount || 0));
    const actualCash = parseMoneyInput(form.cashAmount) + parseMoneyInput(form.mobileAmount);
    // Оплата балансом — у ОБЫЧНЫХ (ручных) "Счётчиков"/"Только касса" НЕ
    // участвует в Разнице (правило 2026-07-25, для decoupled "Списать с
    // баланса" — там списание вообще не связано ни с каким конкретным
    // сеансом/показанием, поэтому "честно исключать" его из Разницы
    // нечего). У TAP-зон — другое дело (найдено пользователем 2026-07-25 на
    // живых данных, "ошибочно включаешь оплату с Баланса в расчёт Разницы"):
    // там оплата балансом происходит НА КОНКРЕТНОМ тапе, который уже учтён
    // как сеанс в netRevenue выше — если не вычесть именно эту часть,
    // Разница показывает фиктивную недостачу ровно на сумму баланса, хотя
    // деньги за неё никогда и не должны были попасть в кассу. Именно
    // TAP-привязанная сумма (tapPaymentBreakdownByZone), НЕ весь
    // counterAbonementByZone — та зонная сумма может включать и старые
    // decoupled списания через "Списать с баланса", не привязанные ни к
    // одному тапу, их эта поправка не касается.
    const counterAbonementAmount = counterAbonementByZone[zoneId] ?? 0;
    const tapAbonementAmount = isCountersTapAssistZone(zone) ? (tapPaymentBreakdownByZone[zoneId]?.abonementAmount ?? 0) : 0;
    const difference = Math.round((actualCash - (netRevenue - tapAbonementAmount)) * 100) / 100;
    return { calculatedRevenue, netRevenue, actualCash, difference, abonementAmount: counterAbonementAmount };
  }

  // Актив "заполнен", если хотя бы один тариф введён — не обязательно все
  // (например, "Вторая скорость" сегодня не использовалась). Незаполненные
  // тарифы этого актива посчитаются как 0 заездов через resolveReading выше.
  function isAssetFilled(zone: ZoneCtx, asset: AssetCtx, form: ZoneFormState) {
    // Актив на ремонте всегда "заполнен" — показание read-only, новый ввод
    // не требуется (запрос пользователя 2026-07-16).
    if (!asset.active) return true;
    return zone.tariffs.some((tariff) => (form.readings[`${asset.id}:${tariff.id}`] ?? "") !== "");
  }

  async function handleSubmit() {
    setSubmitting(true);

    const zoneSubmissions = selectedZoneIds.map((zoneId) => {
      const zone = zones.find((z) => z.id === zoneId)!;
      const form = zoneForms[zoneId];
      // "Прибывания"/"Пуски" — расчёт исключительно от Launch на сервере
      // (см. submit-results/route.ts), показаний нет.
      const readings =
        isStaysZone(zone) || isLaunchesZone(zone)
          ? []
          : zone.assets.flatMap((asset) =>
              zone.tariffs.map((tariff) => ({
                assetId: asset.id,
                tariffId: tariff.id,
                reading: resolveReading(form.readings[`${asset.id}:${tariff.id}`], asset.previousReadings[tariff.id] ?? 0),
              }))
            );
      return {
        zoneId,
        returnsCount: Number(form.returnsCount || 0),
        cashAmount: parseMoneyInput(form.cashAmount),
        mobileAmount: parseMoneyInput(form.mobileAmount),
        readings,
      };
    });

    const payload = {
      zoneSubmissions,
      // Расходы больше не шлём отсюда (запрос пользователя 2026-07-25) —
      // сервер сам берёт их из журнала ZoneExpenseEvent (экран "Расходы").
      // Один ключ на попытку сдачи, переиспользуется при каждом ретрае ЭТОЙ
      // ЖЕ сдачи (аудит 2026-07-25, финальный проход, реальный найденный
      // баг) — офлайн-очередь ниже хранит и повторно шлёт этот ЖЕ объект
      // payload целиком, включая ключ, поэтому связь, оборвавшаяся ПОСЛЕ
      // того, как сервер уже всё создал, но ДО ответа клиенту, больше не
      // приводит к задвоенной сдаче/выручке при автоматическом повторе.
      idempotencyKey: crypto.randomUUID(),
    };

    // Клиентский предпросмотр (та же previewFor, что и на шаге "Проверка") —
    // единственные цифры, которые можно показать, если сдача уходит в
    // офлайн-очередь: сервер их ещё не считал (округления/сверка с кассой
    // на сервере могут чуть отличаться, это лишь предварительный итог).
    const clientSummary = selectedZoneIds.map((zoneId) => {
      const zone = zones.find((z) => z.id === zoneId)!;
      const preview = previewFor(zoneId);
      return {
        zoneId,
        zoneName: zone.name,
        calculatedRevenue: preview?.calculatedRevenue ?? 0,
        actualCash: preview?.actualCash ?? 0,
        difference: preview?.difference ?? 0,
        abonementAmount: preview?.abonementAmount ?? 0,
      };
    });

    async function queueForLater() {
      // try/catch вокруг queueSubmission (аудит 2026-07-27, второй раунд,
      // реальная дыра) — раньше ничем не была обёрнута ни здесь, ни в
      // вызывающих местах ниже: если запись в IndexedDB падает (квота,
      // приватный режим Safari, залоченный профиль киоска), исключение
      // улетало необработанным из onClick-обработчика — setSubmitting(false)
      // не выполнялся (кнопка/спиннер зависали навсегда), setQueued(true) не
      // выполнялся, введённые показания/касса/расходы терялись без единого
      // следа, даже в виде "не сохранено" — оператору нечего было заметить.
      try {
        await queueSubmission(payload);
        setResult({ summary: clientSummary });
        setQueued(true);
      } catch {
        errorToast.flash(t.operatorApp.gameRoom.networkError, "error");
      } finally {
        setSubmitting(false);
      }
    }

    if (!navigator.onLine) {
      await queueForLater();
      return;
    }

    try {
      const res = await fetch("/api/operator/submit-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        playErrorChime();
        errorToast.flash(data.error ?? "Не удалось отправить сдачу итогов", "error");
        setSubmitting(false);
        return;
      }

      setResult(data);
      setSubmitting(false);
    } catch {
      // Сетевая ошибка (не HTTP-ошибка от сервера) — navigator.onLine мог
      // соврать, либо связь пропала прямо во время запроса. Тот же путь,
      // что и явный офлайн: не пугаем оператора ошибкой, кладём в очередь.
      await queueForLater();
    }
  }

  // Z-отчёт сдачи итогов (модуль печати, запрос пользователя 2026-07-20) —
  // внутренний документ для себя/владельца (не клиенту), печать по
  // требованию сразу на экране "Принято". Строится из тех же клиентских
  // данных, что уже отрисованы на этом экране (result.summary), без
  // повторного запроса к серверу.
  function buildZReportData(summary: NonNullable<typeof result>["summary"]): PrintDocumentData {
    const sections: PrintSection[] = summary.map((s) => {
      const isCashOnly = zones.find((z) => z.id === s.zoneId)?.accountingMode === "cash_only";
      return {
        title: s.zoneName,
        lines: [
          ...(isCashOnly
            ? []
            : [
                {
                  label: t.operatorApp.submit.calculatedRevenue,
                  value: formatMoneyWithCurrency(s.calculatedRevenue, locale, currency),
                },
              ]),
          { label: t.operatorApp.submit.actualCash, value: formatMoneyWithCurrency(s.actualCash, locale, currency) },
          ...(isCashOnly
            ? []
            : [
                {
                  label: t.operatorApp.submit.difference,
                  value: `${s.difference > 0 ? "+" : ""}${formatMoneyWithCurrency(s.difference, locale, currency)}`,
                },
              ]),
        ],
      };
    });
    const totalCash = summary.reduce((sum, s) => sum + s.actualCash, 0);
    return {
      title: t.operatorApp.submit.zReportTitle,
      // В очереди (офлайн) — result.summary клиентский предпросмотр, сервер
      // ещё не считал (округления/серверная валидация показаний могут дать
      // другое число) — печатный документ обязан нести ту же пометку, что
      // уже видна на экране (queuedHint), а не только экран: бумага может
      // быть показана/оставлена клиенту отдельно от экрана (аудит 2026-07-24).
      subtitle: `${new Date().toLocaleString(locale)}${printAvailable.operatorName ? ` · ${printAvailable.operatorName}` : ""}${queued ? ` · ${t.operatorApp.submit.zReportPreliminaryNote}` : ""}`,
      sections,
      totalLine: { label: t.operatorApp.submit.actualCash, value: formatMoneyWithCurrency(totalCash, locale, currency) },
    };
  }

  if (loading) return null;

  if (result) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-surface-0 px-4 py-10">
        <SpringCard hover={false} className="w-full max-w-md md:max-w-xl lg:max-w-2xl">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{queued ? t.operatorApp.submit.queuedTitle : t.operatorApp.submit.acceptedTitle}</h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/api/icon-library/app-icons/done.svg" alt="" className="size-7 shrink-0" />
          </div>
          {queued && (
            <p className="mt-2 rounded-control bg-warning/15 px-3 py-2 text-sm font-medium text-warning">
              {t.operatorApp.submit.queuedHint}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-3">
            {result.summary.map((s) => {
              // "Только касса" не имеет расчётной выручки/разницы (docs/spec/01-counters.md:
              // "сравнивать не с чем") — тот же фильтр, что уже применяется на
              // шаге "Проверка" ниже (реальный пред­существующий пробел,
              // найден аудитом 2026-07-20: этот экран после отправки
              // показывал их безусловно для любой зоны).
              const isCashOnly = zones.find((z) => z.id === s.zoneId)?.accountingMode === "cash_only";
              return (
              <div
                key={s.zoneId}
                className="flex flex-col gap-1 rounded-control border border-border p-3 text-body-airbnb"
              >
                <span className="font-semibold">{s.zoneName}</span>
                {!isCashOnly && (
                  <span className="tabular-nums text-muted-foreground">
                    {t.operatorApp.submit.calculatedRevenue} <Money value={s.calculatedRevenue} />
                  </span>
                )}
                <span className="tabular-nums text-muted-foreground">
                  {t.operatorApp.submit.actualCash} <Money value={s.actualCash} />
                </span>
                {!isCashOnly && (
                  <span className="flex items-center gap-1.5 tabular-nums font-semibold">
                    {t.operatorApp.submit.difference}
                    {s.difference !== 0 && <TriangleAlert className="size-3.5 shrink-0 text-warning" />}
                    {s.difference > 0 ? "+" : ""}
                    <Money value={s.difference} />
                  </span>
                )}
              </div>
              );
            })}
            {result.remindMarkDeparture && (
              <p className="rounded-control bg-warning/15 px-3 py-2 text-sm font-medium text-warning">
                {t.operatorApp.workTime.markDepartureReminder}
              </p>
            )}
            {/* Z-отчёт — внутренний документ, не клиенту (модуль печати,
                запрос пользователя 2026-07-20), печать по требованию. */}
            {printAvailable.available && (
              <PrintButton
                label={t.operatorApp.submit.printZReportButton}
                data={buildZReportData(result.summary)}
                branding={printAvailable.branding}
                className="w-full gap-1.5 rounded-lg"
              />
            )}
            <PressableScale>
              <Button onClick={() => router.push("/operator")} className="h-14 w-full gap-2 rounded-control font-bold">
                <Home className="size-5" />
                {t.operatorApp.submit.homeButton}
              </Button>
            </PressableScale>
          </div>
        </SpringCard>
      </div>
    );
  }

  const activeZone = currentStep.kind === "zone" ? zones.find((z) => z.id === currentStep.zoneId) ?? null : null;
  const activeForm = activeZone ? zoneForms[activeZone.id] : null;
  const activeAsset =
    activeZone && assetSheetId ? activeZone.assets.find((a) => a.id === assetSheetId) ?? null : null;

  const filledCount =
    activeZone && activeForm ? activeZone.assets.filter((a) => isAssetFilled(activeZone, a, activeForm)).length : 0;

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-32 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-xl lg:max-w-2xl">
        <div className="flex items-center justify-between">
          <BackLink
            label={stepIndex === 0 ? t.operatorApp.submit.cancelWizard : t.common.back}
            onClick={stepIndex === 0 ? () => router.push("/operator") : goBack}
          />
          <span className="text-caption-airbnb font-semibold text-muted-foreground/70">
            {t.operatorApp.submit.stepLabel} {stepIndex + 1} {t.common.of} {steps.length}
          </span>
        </div>

        <div className="mt-3 mb-5 flex gap-1.5">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-border")}
            />
          ))}
        </div>

        {currentStep.kind === "select" && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">
                {t.operatorApp.submit.selectZonesTitle}
              </h1>
              <p className="mt-1 text-[0.84375rem] text-muted-foreground">{t.operatorApp.submit.selectZonesSub}</p>
            </div>

            {zones.length === 0 ? (
              <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.submit.noZonesConfigured}</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
                {zones.map((zone) => {
                  const selected = selectedZoneIds.includes(zone.id);
                  return (
                    <PressableScale key={zone.id} className="relative">
                      <button
                        type="button"
                        onClick={() => toggleZone(zone.id)}
                        className={cn(
                          "relative flex w-full flex-col items-center gap-2.5 rounded-card border-[1.5px] px-3 py-5 text-center shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]",
                          selected ? "border-primary bg-primary/10" : "border-border bg-card"
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-14 items-center justify-center rounded-control",
                            selected ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/50"
                          )}
                        >
                          {zone.iconKey ? (
                            <AssetOrZoneIcon iconKey={zone.iconKey} className="size-9" />
                          ) : (
                            <MapPin className="size-9" />
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[0.90625rem] font-semibold",
                            selected ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {zone.name}
                        </span>
                      </button>
                      {selected && (
                        <span className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                          <Check className="size-5" />
                        </span>
                      )}
                    </PressableScale>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {currentStep.kind === "zone" && activeZone && activeForm && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{activeZone.name}</h1>
              <p className="mt-1 text-[0.84375rem] text-muted-foreground">
                {activeZone.accountingMode === "cash_only"
                  ? t.operatorApp.submit.cashOnlySub
                  : isTicketsZone(activeZone)
                    ? t.operatorApp.submit.ticketsSub
                    : isStaysZone(activeZone) || isLaunchesZone(activeZone)
                      ? t.operatorApp.submit.gameRoomSub
                      : isCountersTapAssistZone(activeZone)
                        ? t.operatorApp.submit.countersTapAssistSub
                        : t.operatorApp.submit.enterReadingsSub}
              </p>
            </div>

            {isStaysZone(activeZone) &&
              gameRoomOpenByAsset.map((entry) => {
                const asset = activeZone.assets.find((a) => a.id === entry.assetId);
                return (
                  <div key={entry.assetId} className="rounded-card border border-warning/40 bg-warning/10 p-3.5">
                    <p className="text-body-airbnb font-semibold text-warning">
                      {t.operatorApp.submit.gameRoomBlockedPrefix} {entry.count} {t.operatorApp.submit.gameRoomBlockedSuffix}{" "}
                      «{asset?.name}»
                    </p>
                    <PressableScale className="mt-2 inline-block">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 gap-1.5 rounded-control border-warning/40 text-warning"
                        onClick={() => router.push(`/operator/game-room?assetId=${entry.assetId}`)}
                      >
                        {t.operatorApp.submit.gameRoomGoToAssetButton}
                        <ChevronRight className="size-4" />
                      </Button>
                    </PressableScale>
                  </div>
                );
              })}

            {activeZone.accountingMode !== "cash_only" &&
              !isStaysZone(activeZone) &&
              !isLaunchesZone(activeZone) &&
              !isTicketsZone(activeZone) && (
            <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
              {activeZone.assets.map((asset) => {
                const filled = isAssetFilled(activeZone, asset, activeForm);
                return (
                  <PressableScale key={asset.id} className="relative">
                    <button
                      type="button"
                      // Тапы-показания (запрос пользователя 2026-07-25) — тут
                      // нечего вводить руками, сами тапы делаются заранее на
                      // отдельном экране "Счётчики" (нижний бар); открывать
                      // sheet с полем ввода для такого актива не нужно.
                      onClick={() => {
                        if (!isCountersTapAssistZone(activeZone)) setAssetSheetId(asset.id);
                      }}
                      className={cn(
                        "relative flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]",
                        filled ? "border-success" : "border-border",
                        !asset.active && "grayscale",
                        isCountersTapAssistZone(activeZone) && "cursor-default"
                      )}
                    >
                      <div
                        className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden bg-muted"
                        {...(asset.photoUrl
                          ? {
                              onPointerDown: () => handlePhotoPressStart(asset.photoUrl!),
                              onPointerUp: handlePhotoPressEnd,
                              onPointerLeave: handlePhotoPressEnd,
                              onPointerCancel: handlePhotoPressEnd,
                              onClick: handlePhotoClick,
                            }
                          : {})}
                      >
                        {asset.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.photoUrl} alt="" className="size-full object-contain object-center" />
                        ) : asset.iconKey ? (
                          <AssetOrZoneIcon iconKey={asset.iconKey} className="size-12 text-muted-foreground" />
                        ) : null}
                        <span
                          className="absolute left-2.5 top-2.5 size-4 rounded-full ring-[2.5px] ring-card"
                          style={{ backgroundColor: asset.colorTag }}
                        />
                      </div>
                      <div className="flex flex-col gap-1 p-3" style={{ background: colorTagGradient(asset.colorTag) }}>
                        <span className="text-[0.90625rem] font-bold tracking-[-0.01em]">{asset.name}</span>
                        <span className="text-xs leading-snug text-muted-foreground">
                          {filled
                            ? activeZone.tariffs
                                .map((tariff) => {
                                  const key = `${asset.id}:${tariff.id}`;
                                  const previous = asset.previousReadings[tariff.id] ?? 0;
                                  return `${tariff.name}: ${resolveReading(activeForm.readings[key], previous)}`;
                                })
                                .join(" · ")
                            : t.operatorApp.submit.assetNotFilled}
                        </span>
                      </div>
                    </button>
                    {filled && (
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

            {/* "Прибывания"/"Пуски" — Активы по аналогии со счётчиками (запрос
                пользователя 2026-07-17): тайл на каждый актив, внутри —
                расчётная сумма read-only + реальные Наличные/Безнал,
                которые вносит сотрудник (см. sheet ниже). */}
            {(isStaysZone(activeZone) || isLaunchesZone(activeZone)) && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
                {activeZone.assets.map((asset) => {
                  const entry = activeForm.assetCash[asset.id];
                  // "Подтверждено" — нажатие "Сохранить" в sheet'е, а не
                  // непустые поля (запрос пользователя 2026-07-18: "если
                  // Сотрудник не заполнил Наличные и Безнал... значения не
                  // запоминаются" — 0/0, потому что никого не было, тоже
                  // осознанное решение, должно засчитываться как заполнено).
                  const filled = activeForm.confirmedAssetIds.includes(asset.id);
                  const revenue = gameRoomRevenueByAsset.find((r) => r.assetId === asset.id);
                  // Пока по активу есть незакрытые пуски, реальную кассу
                  // сдавать нельзя — счёт ещё не окончателен (запрос
                  // пользователя 2026-07-17: "не должно быть возможности
                  // кликнуть по Активу... они должны быть серыми/не
                  // активными"), баннер выше уже даёт переход завершить их.
                  const blocked = (gameRoomOpenByAsset.find((o) => o.assetId === asset.id)?.count ?? 0) > 0;
                  return (
                    <PressableScale key={asset.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setAssetSheetId(asset.id)}
                        disabled={blocked}
                        className={cn(
                          "relative flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]",
                          filled ? "border-success" : "border-border",
                          "disabled:pointer-events-none disabled:grayscale disabled:opacity-40"
                        )}
                      >
                        <div
                          className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden bg-muted"
                          {...(asset.photoUrl
                            ? {
                                onPointerDown: () => handlePhotoPressStart(asset.photoUrl!),
                                onPointerUp: handlePhotoPressEnd,
                                onPointerLeave: handlePhotoPressEnd,
                                onPointerCancel: handlePhotoPressEnd,
                                onClick: handlePhotoClick,
                              }
                            : {})}
                        >
                          {asset.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={asset.photoUrl} alt="" className="size-full object-contain object-center" />
                          ) : asset.iconKey ? (
                            <AssetOrZoneIcon iconKey={asset.iconKey} className="size-12 text-muted-foreground" />
                          ) : null}
                          <span
                            className="absolute left-2.5 top-2.5 size-4 rounded-full ring-[2.5px] ring-card"
                            style={{ backgroundColor: asset.colorTag }}
                          />
                        </div>
                        <div className="flex flex-col gap-1 p-3" style={{ background: colorTagGradient(asset.colorTag) }}>
                          <span className="text-[0.90625rem] font-bold tracking-[-0.01em]">{asset.name}</span>
                          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug text-muted-foreground">
                            {filled ? (
                              <>
                                <span className="inline-flex items-center gap-1">
                                  <PaymentMethodIcon method="cash" className="size-3 shrink-0" />
                                  {t.operatorApp.submit.cashLabel} {entry?.cash || 0}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <PaymentMethodIcon method="mobile" className="size-3 shrink-0" />
                                  {t.operatorApp.submit.mobileLabel} {entry?.mobile || 0}
                                </span>
                              </>
                            ) : revenue ? (
                              <>
                                {t.operatorApp.submit.calculatedRevenue} {revenue.calculatedAmount}
                              </>
                            ) : (
                              t.operatorApp.submit.assetNotFilled
                            )}
                          </span>
                        </div>
                      </button>
                      {filled && (
                        <span className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-success text-success-foreground shadow-md">
                          <Check className="size-5" />
                        </span>
                      )}
                    </PressableScale>
                  );
                })}
              </div>
            )}

            {!isStaysZone(activeZone) && !isLaunchesZone(activeZone) &&
              (() => {
                // Расчётная подсказка по способу оплаты, отмеченному на тапах
                // (запрос пользователя 2026-07-25: "не видно сколько по
                // наличному и безналичному") — только справочно, поля ниже
                // по-прежнему вводятся вручную (сверка факта с расчётом
                // должна остаться реальной проверкой, не самозаполнением).
                // Тапы без способа оплаты (старые записи) в эту подсказку не
                // попадают. Берётся НАПРЯМУЮ из paymentBreakdown (API уже
                // считает точно — конкретный помеченный "Возврат/тест" тап
                // исключён из СВОЕГО способа оплаты, см. counter-tap-events/
                // route.ts). Реальный баг, найден пользователем 2026-07-25:
                // здесь ЕЩЁ РАЗ домножалось на коэффициент
                // netRevenue/calculatedRevenue поверх уже точного числа —
                // двойной вычет, отсюда дробные 30,63/91,88 вместо целых
                // 35/105. Коэффициент убран полностью, raw используется как
                // есть. Показывается КРУПНО, в одной строке с полем ввода — и
                // по тапу сама подставляет значение в поле, чтобы не
                // перепечатывать вручную.
                let cashHint = 0;
                let mobileHint = 0;
                if (isCountersTapAssistZone(activeZone)) {
                  const raw = tapPaymentBreakdownByZone[activeZone.id];
                  if (raw) {
                    cashHint = raw.cashAmount;
                    mobileHint = raw.mobileAmount;
                  }
                } else if (isTicketsZone(activeZone)) {
                  // Билеты (запрос пользователя 2026-07-28: "перенести в один
                  // ряд с полями ввода") — тот же приём, что уже был у
                  // "Счётчиков" выше, просто источник другой: разбивка
                  // способов оплаты проданных заказов (ticketsAggregateByZone),
                  // не тапы. По докам (docs/spec/10-tickets.md) так и
                  // задумывалось изначально — "подсказкой у полей кассы", это
                  // раньше просто не было реализовано этим способом.
                  const raw = ticketsAggregateByZone[activeZone.id];
                  if (raw) {
                    cashHint = raw.cashAmount;
                    mobileHint = raw.mobileAmount;
                  }
                }
                // Тап сразу подставляет значение в поле (запрос пользователя
                // 2026-07-28: "не будем делать изначально скрытым, пусть
                // будет видно всегда") — раньше был промежуточный шаг
                // "раскрыть размытие", больше не нужен, число видно сразу.
                const fillCash = () => updateZoneField(activeZone.id, "cashAmount", String(cashHint));
                const fillMobile = () => updateZoneField(activeZone.id, "mobileAmount", String(mobileHint));
                return (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="cash" className="flex items-center gap-1.5">
                        <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                        {t.operatorApp.submit.cashLabel}
                      </Label>
                      {/* Подсказка — ПЕРЕД полем ввода, вровень с ним по
                          высоте (запрос пользователя 2026-07-25). Тап
                          подставляет значение в поле. Мелкая подпись
                          "расчётно" — понятно, что это за число. Приглушённый
                          серый, без цветного фона — остаётся подсказкой, не
                          акцентной кнопкой. */}
                      <div className="flex items-center gap-2">
                        {cashHint > 0 && (
                          <PressableScale className="shrink-0">
                            <button
                              type="button"
                              onClick={fillCash}
                              className="flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control px-2.5"
                            >
                              <span className="text-lg font-semibold tabular-nums leading-none text-muted-foreground/50">
                                <Money value={cashHint} />
                              </span>
                              <span className="text-[0.625rem] leading-none text-muted-foreground/40">
                                {t.operatorApp.submit.tapHintCaption}
                              </span>
                            </button>
                          </PressableScale>
                        )}
                        <MoneyInput
                          id="cash"
                          scale="lg"
                          inputMode="numeric"
                          className="h-14 rounded-control bg-muted text-lg font-bold"
                          value={activeForm.cashAmount}
                          onChange={(e) => updateZoneField(activeZone.id, "cashAmount", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="mobile" className="flex items-center gap-1.5">
                        <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                        {t.operatorApp.submit.mobileLabel}
                      </Label>
                      <div className="flex items-center gap-2">
                        {mobileHint > 0 && (
                          <PressableScale className="shrink-0">
                            <button
                              type="button"
                              onClick={fillMobile}
                              className="flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control px-2.5"
                            >
                              <span className="text-lg font-semibold tabular-nums leading-none text-muted-foreground/50">
                                <Money value={mobileHint} />
                              </span>
                              <span className="text-[0.625rem] leading-none text-muted-foreground/40">
                                {t.operatorApp.submit.tapHintCaption}
                              </span>
                            </button>
                          </PressableScale>
                        )}
                        <MoneyInput
                          id="mobile"
                          scale="lg"
                          inputMode="numeric"
                          className="h-14 rounded-control bg-muted text-lg font-bold"
                          value={activeForm.mobileAmount}
                          onChange={(e) => updateZoneField(activeZone.id, "mobileAmount", e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                );
              })()}
            {!isStaysZone(activeZone) && !isLaunchesZone(activeZone) && (
              <>

                {(() => {
                  // previewFor() теперь сам знает про Билеты (см. её
                  // определение выше) — единая формула для обоих режимов, не
                  // дублируем здесь.
                  const preview = activeZone.accountingMode !== "cash_only" ? previewFor(activeZone.id) : null;
                  const abonementAmount =
                    activeZone.accountingMode === "counters" || activeZone.accountingMode === "cash_only"
                      ? (counterAbonementByZone[activeZone.id] ?? 0)
                      : 0;
                  if (!preview && abonementAmount <= 0) return null;
                  return (
                    <div className="flex flex-col gap-1.5">
                      {/* "Расчётная выручка" убрана (запрос пользователя
                          2026-07-25) — preview.calculatedRevenue остаётся в
                          расчёте (Разница по-прежнему от net), просто больше
                          не выводится отдельной строкой. */}
                      {/* Разница и Баланс — в одну строку, крупным размером
                          (запрос пользователя 2026-07-25), без плашки-фона —
                          это те два числа, по которым Сотрудник/Владелец
                          реально решают "сошлось", не должны теряться среди
                          остального. Разница — половина строки, если Баланс
                          тоже есть; одна на всю строку, если Баланса нет. */}
                      <div className="flex items-center gap-4">
                        {preview && (
                          <div className="flex flex-1 items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 font-semibold">
                              {t.operatorApp.submit.difference}
                              {preview.difference !== 0 && <TriangleAlert className="size-4 shrink-0 text-warning" />}
                            </span>
                            <span
                              className={cn(
                                "text-lg font-extrabold tabular-nums",
                                preview.difference !== 0 && "text-warning"
                              )}
                            >
                              {preview.difference > 0 ? "+" : ""}
                              <Money value={preview.difference} />
                            </span>
                          </div>
                        )}
                        {/* "Счётчики"/"Только касса" — справочная строка
                            "Баланс" (реальный баг, найден пользователем
                            2026-07-24: без неё сотрудник не видел, что часть
                            выручки уже оплачена с баланса). */}
                        {abonementAmount > 0 && (
                          <div className="flex flex-1 items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 font-semibold">
                              <PaymentMethodIcon method="abonement" className="size-4 shrink-0" />
                              {t.operatorApp.abonement.paymentLabel}
                            </span>
                            <span className="text-lg font-extrabold tabular-nums">
                              <Money value={abonementAmount} />
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {/* Возвраты/тестовые пуски — перенесено под "Баланс" (запрос
                    пользователя 2026-07-25), без плашки-фона, как и
                    остальные строки здесь. Только "counters" (докс:
                    "Возвраты/тестовые пуски... только counters") — у
                    cash_only этого поля нет вовсе. */}
                {activeZone.accountingMode === "counters" && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-1.5 text-body-airbnb font-semibold">
                      <RefreshCcw className="size-4 shrink-0" />
                      {t.operatorApp.submit.returnsLabel}
                    </p>
                    {/* Read-only (запрос пользователя 2026-07-24) — источник
                        числа теперь пункт нижнего бара "Счётчики", тут его
                        больше нельзя поправить руками. */}
                    <span className="text-[0.9375rem] font-bold tabular-nums">{activeForm.returnsCount || 0}</span>
                  </div>
                )}
                {/* Билеты — Наличные/Безнал переехали в один ряд с полями
                    ввода выше (запрос пользователя 2026-07-28), тот же приём
                    размытия/тапа, что у "Счётчиков" — см. cashHint/mobileHint
                    в начале этого блока. Баланс своего поля ввода не имеет
                    (оплата балансом идёт мимо кассы Наличные/Безнал), поэтому
                    остаётся здесь отдельной справочной строкой. */}
                {isTicketsZone(activeZone) &&
                  ticketsAggregateByZone[activeZone.id] &&
                  ticketsAggregateByZone[activeZone.id].abonementAmount > 0 && (
                    <div className="flex items-center justify-between text-caption-airbnb text-muted-foreground tabular-nums">
                      <span className="flex items-center gap-1.5">
                        <PaymentMethodIcon method="abonement" className="size-3.5 shrink-0" />
                        {t.operatorApp.abonement.paymentLabel}
                      </span>
                      <span><Money value={ticketsAggregateByZone[activeZone.id].abonementAmount} /></span>
                    </div>
                  )}
              </>
            )}
          </div>
        )}

        {currentStep.kind === "expenses" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.submit.expensesTitle}</h1>
            {selectedZoneIds.map((zoneId) => {
              const items = expenseEventsByZone[zoneId] ?? [];
              if (items.length === 0) return null;
              const zone = zones.find((z) => z.id === zoneId);
              return (
                <div key={zoneId} className="flex flex-col gap-2">
                  {selectedZoneIds.length > 1 && (
                    <p className="text-caption-airbnb font-semibold text-muted-foreground">{zone?.name}</p>
                  )}
                  {items.map((expense) => (
                    <div
                      key={expense.id}
                      className="flex items-center justify-between gap-3 rounded-card border border-border bg-card p-3 shadow-card-rest"
                    >
                      <div className="min-w-0">
                        <p className="text-body-airbnb font-semibold">{expense.categoryName ?? t.operatorApp.submit.expensesTitle}</p>
                        <p className="truncate text-caption-airbnb text-muted-foreground">
                          {formatTime(expense.createdAt)}
                          {expense.comment ? ` · ${expense.comment}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums font-bold"><Money value={expense.amount} /></span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {currentStep.kind === "review" && (
          <div className="flex flex-col gap-3">
            <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.submit.reviewTitle}</h1>
            {selectedZoneIds.map((zoneId) => {
              const zone = zones.find((z) => z.id === zoneId)!;
              const preview = previewFor(zoneId);
              return (
                <div
                  key={zoneId}
                  className="flex flex-col gap-1 rounded-card border border-border bg-card p-3 text-body-airbnb shadow-card-rest"
                >
                  <span className="font-semibold">{zone.name}</span>
                  {preview && (zone.accountingMode === "cash_only" || isStaysZone(zone) || isLaunchesZone(zone)) && (
                    <span className="tabular-nums text-muted-foreground">
                      {t.operatorApp.submit.actualCash} <Money value={preview.actualCash} />
                    </span>
                  )}
                  {preview && zone.accountingMode !== "cash_only" && !isStaysZone(zone) && !isLaunchesZone(zone) && (
                    <>
                      <span className="tabular-nums text-muted-foreground">
                        {t.operatorApp.submit.calculatedRevenue} <Money value={preview.calculatedRevenue} />
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {t.operatorApp.submit.actualCash} <Money value={preview.actualCash} />
                      </span>
                      <span className="flex items-center gap-1.5 tabular-nums font-semibold">
                        {t.operatorApp.submit.difference}
                        {preview.difference !== 0 && <TriangleAlert className="size-3.5 shrink-0 text-warning" />}
                        {preview.difference > 0 ? "+" : ""}
                        <Money value={preview.difference} />
                      </span>
                    </>
                  )}
                  {preview &&
                    !isStaysZone(zone) &&
                    !isLaunchesZone(zone) &&
                    preview.calculatedRevenue === 0 &&
                    preview.actualCash === 0 && (
                      <span className="mt-1 text-caption-airbnb text-warning">{t.operatorApp.submit.allZeroWarning}</span>
                    )}
                </div>
              );
            })}
            <PressableScale>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="h-14 w-full gap-2 rounded-control font-bold"
              >
                <Send className="size-5" />
                {submitting ? t.operatorApp.submit.submitting : t.operatorApp.submit.submitButton}
              </Button>
            </PressableScale>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/90 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md gap-3 md:max-w-xl lg:max-w-2xl">
          <PressableScale className="flex-1">
            <Button
              variant="outline"
              className="h-14 w-full gap-2 rounded-control border-border"
              onClick={stepIndex === 0 ? () => router.push("/operator") : goBack}
            >
              <ChevronLeft className="size-5" />
              {stepIndex === 0 ? t.operatorApp.submit.cancelWizard : t.common.back}
            </Button>
          </PressableScale>
          {currentStep.kind !== "review" && (
            <PressableScale className="flex-[1.6]">
              <Button
                className="h-14 w-full gap-2 rounded-control font-bold"
                onClick={goNext}
                disabled={
                  (currentStep.kind === "select" && selectedZoneIds.length === 0) ||
                  (currentStep.kind === "zone" &&
                    !!activeZone &&
                    isStaysZone(activeZone) &&
                    gameRoomOpenByAsset.length > 0)
                }
              >
                {t.common.next}
                {currentStep.kind === "zone" &&
                  !!activeZone &&
                  activeZone.accountingMode !== "cash_only" &&
                  !isStaysZone(activeZone) &&
                  !isLaunchesZone(activeZone) && (
                  <span className="text-xs font-semibold tabular-nums opacity-75">
                    {filledCount}/{activeZone?.assets.length ?? 0}
                  </span>
                )}
                <ChevronRight className="size-5" />
              </Button>
            </PressableScale>
          )}
        </div>
      </div>

      <BottomSheet open={assetSheetId !== null} onClose={() => setAssetSheetId(null)}>
        {activeZone && activeForm && activeAsset && (isStaysZone(activeZone) || isLaunchesZone(activeZone)) && (
          <div className="flex flex-col gap-4 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{activeAsset.name}</h2>
            {(() => {
              const revenue = gameRoomRevenueByAsset.find((r) => r.assetId === activeAsset.id);
              const calculated = revenue?.calculatedAmount ?? 0;
              const entry = activeForm.assetCash[activeAsset.id] ?? { cash: "", mobile: "" };
              const hasEntry = entry.cash.trim() !== "" || entry.mobile.trim() !== "";
              const actual = parseMoneyInput(entry.cash) + parseMoneyInput(entry.mobile);
              // Абонемент прибавляется к факту здесь же — та касса уже
              // получила эти деньги раньше, при пополнении абонемента, не
              // сейчас (тот же баг, найден пользователем 2026-07-18 на этой
              // самой плашке: "Разница" ложно показывала недостачу ровно на
              // абонементную сумму актива — тот же класс, что уже пофикшен
              // в lib/reports.ts/submit-results/counters-day/home-summary/
              // readings, просто пропущен здесь).
              const diff = Math.round((actual + (revenue?.abonementAmount ?? 0) - calculated) * 100) / 100;
              // Наличные/Безнал переехали в один ряд со своими полями ввода
              // (запрос пользователя 2026-07-28), тот же приём, что у
              // "Счётчиков"/"Билетов" — тап сразу подставляет значение, без
              // предварительного размытия (тот же запрос, "пусть будет видно
              // всегда").
              const fillAssetCash = () => {
                if (revenue) updateAssetCash(activeZone.id, activeAsset.id, "cash", String(revenue.cashAmount));
              };
              const fillAssetMobile = () => {
                if (revenue) updateAssetCash(activeZone.id, activeAsset.id, "mobile", String(revenue.mobileAmount));
              };
              return (
                <>
                  {/* Расчётно — общий ориентир (наличные+безнал+баланс), без
                      разбивки по способам рядом с ним — та теперь подсказками
                      прямо у Наличные/Безнал ниже (запрос пользователя
                      2026-07-28). Баланс своего поля ввода не имеет (оплата
                      произошла раньше, при пополнении), поэтому остаётся
                      здесь единственной справочной строкой. */}
                  <div className="flex items-center justify-between gap-2 rounded-control bg-muted p-3.5">
                    <div className="flex min-w-0 flex-col tabular-nums">
                      <span className="text-caption-airbnb text-muted-foreground">
                        {t.operatorApp.submit.calculatedRevenue}
                      </span>
                      <span className="text-xl font-extrabold leading-none tracking-[-0.02em]">
                        <Money value={calculated} />
                      </span>
                    </div>
                    {revenue && revenue.abonementAmount > 0 && (
                      <span className="text-right text-caption-airbnb tabular-nums">
                        {t.operatorApp.abonement.paymentLabel}:{" "}
                        <span className="font-bold text-foreground">
                          <Money value={revenue.abonementAmount} />
                        </span>
                      </span>
                    )}
                  </div>
                  {/* Крупная кнопка "Сохранить" — на оба поля разом (запрос
                      пользователя 2026-07-17: "на 2 поля: наличные и безнал
                      или 2 тарифов"), растянута на их общую высоту, не
                      отдельной строкой и не только у последнего поля. */}
                  <div className="flex items-stretch gap-2">
                    <div className="flex flex-1 flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="assetCash">{t.operatorApp.submit.cashLabel}</Label>
                        <div className="flex items-center gap-2">
                          {revenue && revenue.cashAmount > 0 && (
                            <PressableScale className="shrink-0">
                              <button
                                type="button"
                                onClick={fillAssetCash}
                                className="flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control px-2.5"
                              >
                                <span className="text-lg font-semibold tabular-nums leading-none text-muted-foreground/50">
                                  <Money value={revenue.cashAmount} />
                                </span>
                                <span className="text-[0.625rem] leading-none text-muted-foreground/40">
                                  {t.operatorApp.submit.tapHintCaption}
                                </span>
                              </button>
                            </PressableScale>
                          )}
                          <MoneyInput
                            id="assetCash"
                            autoFocus={activeAsset.active}
                            disabled={!activeAsset.active}
                            scale="lg"
                            inputMode="numeric"
                            className="h-14 rounded-control bg-muted text-lg font-bold"
                            value={entry.cash}
                            onChange={(e) => updateAssetCash(activeZone.id, activeAsset.id, "cash", e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="assetMobile">{t.operatorApp.submit.mobileLabel}</Label>
                        <div className="flex items-center gap-2">
                          {revenue && revenue.mobileAmount > 0 && (
                            <PressableScale className="shrink-0">
                              <button
                                type="button"
                                onClick={fillAssetMobile}
                                className="flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control px-2.5"
                              >
                                <span className="text-lg font-semibold tabular-nums leading-none text-muted-foreground/50">
                                  <Money value={revenue.mobileAmount} />
                                </span>
                                <span className="text-[0.625rem] leading-none text-muted-foreground/40">
                                  {t.operatorApp.submit.tapHintCaption}
                                </span>
                              </button>
                            </PressableScale>
                          )}
                          <MoneyInput
                            id="assetMobile"
                            disabled={!activeAsset.active}
                            scale="lg"
                            inputMode="numeric"
                            className="h-14 rounded-control bg-muted text-lg font-bold"
                            value={entry.mobile}
                            onChange={(e) => updateAssetCash(activeZone.id, activeAsset.id, "mobile", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    <PressableScale className="flex">
                      {/* Вертикальная (запрос пользователя 2026-07-28: "чтобы
                          было больше места для расчётных сумм") — та же
                          кнопка, просто уже по ширине и текст читается сверху
                          вниз, освобождает горизонтальное место полям слева. */}
                      <SaveButton
                        className="h-full w-14 min-w-0 flex-col gap-1.5 rounded-control px-1 font-bold"
                        saved={assetSheetSaved}
                        onClick={() =>
                          pulseAssetSheet(() => {
                            confirmAssetCash(activeZone.id, activeAsset.id);
                            setAssetSheetId(null);
                          })
                        }
                      >
                        <span className="[writing-mode:vertical-rl] rotate-180">{t.common.save}</span>
                      </SaveButton>
                    </PressableScale>
                  </div>
                  {hasEntry && (
                    <p
                      className={cn(
                        "text-caption-airbnb font-semibold tabular-nums",
                        diff === 0 ? "text-primary" : "text-warning"
                      )}
                    >
                      {t.operatorApp.submit.difference} {diff > 0 ? "+" : ""}
                      <Money value={diff} />
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        )}
        {activeZone && activeForm && activeAsset && !isStaysZone(activeZone) && !isLaunchesZone(activeZone) && (
          <div className="flex flex-col gap-4 pt-2">
            <div className="relative flex h-[150px] w-full items-center justify-center overflow-hidden rounded-card bg-muted">
              {activeAsset.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeAsset.photoUrl} alt="" className="size-full object-contain object-center" />
              ) : activeAsset.iconKey ? (
                <AssetOrZoneIcon iconKey={activeAsset.iconKey} className="size-16 text-muted-foreground" />
              ) : null}
              <span
                className="absolute left-3 top-3 size-4.5 rounded-full ring-[3px] ring-card"
                style={{ backgroundColor: activeAsset.colorTag }}
              />
            </div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{activeAsset.name}</h2>
            {!activeAsset.active && (
              <p className="rounded-control bg-muted px-3 py-2 text-caption-airbnb text-muted-foreground">
                {t.operatorApp.submit.assetInactiveHint}
              </p>
            )}

            {/* Крупная кнопка "Сохранить" — растянута на оба тарифа разом,
                не только на последний (запрос пользователя 2026-07-17: "на
                2 поля... или 2 тарифов"); при одном тарифе вырождается в
                тот же паттерн, что уже был — поле + кнопка в одной строке. */}
            <div className="flex items-stretch gap-2">
              <div className="flex flex-1 flex-col gap-3">
                {activeZone.tariffs.map((tariff) => {
                  const isLaunches = activeZone.accountingMode === "launches";
                  const key = `${activeAsset.id}:${tariff.id}`;
                  const value = activeForm.readings[key] ?? "";
                  const previous = activeAsset.previousReadings[tariff.id] ?? 0;
                  const parsed = value.trim() === "" ? null : Number(value);
                  const invalid = value.trim() !== "" && (!Number.isFinite(parsed) || parsed! < 0 || parsed! > 9999);
                  const rollover = !isLaunches && !invalid && parsed !== null && parsed < previous;
                  const sessions =
                    !invalid && parsed !== null ? (isLaunches ? parsed : calcSessions(parsed, previous)) : null;

                  return (
                    <div key={tariff.id} className="flex flex-col gap-1">
                      <Label htmlFor={key}>
                        {tariff.name}
                        {!isLaunches && (
                          <span className="font-normal text-muted-foreground">
                            {" "}· {t.operatorApp.submit.previousReading} {previous}
                          </span>
                        )}
                      </Label>
                      <Input
                        id={key}
                        autoFocus={activeAsset.active}
                        disabled={!activeAsset.active}
                        inputMode="numeric"
                        // Счётчики — 4 разряда (0-9999), см. AssetReading.reading в
                        // schema.prisma — maxLength не даёт физически ввести 5-й
                        // символ, а не только показывает предупреждение постфактум.
                        maxLength={4}
                        placeholder="0–9999"
                        className="h-14 rounded-control bg-muted text-xl font-bold tabular-nums"
                        value={activeAsset.active ? value : String(previous)}
                        onChange={(e) => updateReading(activeZone.id, key, e.target.value)}
                      />
                      {value.trim() !== "" && (
                        <p
                          className={cn(
                            "text-caption-airbnb font-semibold",
                            invalid || rollover ? "text-warning" : "text-primary"
                          )}
                        >
                          {invalid
                            ? t.operatorApp.submit.invalidNumberWarning
                            : isLaunches
                              ? `${t.operatorApp.submit.sessionsLabel} ${sessions}`
                              : `${t.operatorApp.submit.sessionsLabel} ${sessions}${
                                  rollover ? " · " + t.operatorApp.submit.rolloverWarning : ""
                                }`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <PressableScale className="flex">
                <SaveButton
                  className="h-full w-14 min-w-0 flex-col gap-1.5 rounded-control px-1 font-bold"
                  saved={assetSheetSaved}
                  onClick={() => pulseAssetSheet(() => setAssetSheetId(null))}
                >
                  <span className="[writing-mode:vertical-rl] rotate-180">{t.common.save}</span>
                </SaveButton>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      <ImageLightbox src={lightboxUrl} />
      <ActionToast message={errorToast.message} variant={errorToast.variant} />
    </div>
  );
}
