"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Home, MapPin, Minus, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ImageLightbox } from "@/components/motion/image-lightbox";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import {
  calcSessions,
  calcZoneGrossRevenue,
  calcZoneRevenue,
  isLaunchesZone,
  isStaysZone,
  type ZoneAccountingMode,
} from "@/lib/results-calc";
import { queueSubmission } from "@/lib/offline-submissions";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { PrintButton } from "@/components/print/print-button";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import type { PrintDocumentData, PrintSection } from "@/lib/print/receipt-document";
import { formatMoneyWithCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

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

interface ExpenseRow {
  zoneId: string;
  amount: string;
  comment: string;
  categoryId: string;
}

interface ExpenseCategoryCtx {
  id: string;
  name: string;
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
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryCtx[]>([]);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [zoneForms, setZoneForms] = useState<Record<string, ZoneFormState>>({});
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
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
  const [submitError, setSubmitError] = useState<string | null>(null);
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
  const [result, setResult] = useState<{
    summary: { zoneId: string; zoneName: string; calculatedRevenue: number; actualCash: number; difference: number }[];
    remindMarkDeparture?: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/operator/submission-context")
      .then(async (res) => {
        if (!res.ok) {
          router.replace("/operator/login");
          return;
        }
        const data = await res.json();
        setZones(data.zones ?? []);
        setExpenseCategories(data.expenseCategories ?? []);
        setLoading(false);
      });
  }, [router]);

  const steps: Step[] = useMemo(() => {
    const list: Step[] = [{ kind: "select" }];
    for (const zoneId of selectedZoneIds) list.push({ kind: "zone", zoneId });
    if (selectedZoneIds.length > 0) list.push({ kind: "expenses" }, { kind: "review" });
    return list;
  }, [selectedZoneIds]);

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          returnsCount: "0",
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
        String(Object.values(assetCash).reduce((total, e) => total + (Number(e[key]) || 0), 0));
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

  function addExpense() {
    setExpenses((prev) => [
      ...prev,
      { zoneId: selectedZoneIds[0] ?? "", amount: "", comment: "", categoryId: "" },
    ]);
  }

  function updateExpense(index: number, field: keyof ExpenseRow, value: string) {
    setExpenses((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  }

  function removeExpense(index: number) {
    setExpenses((prev) => prev.filter((_, i) => i !== index));
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
    const netRevenue = calcZoneRevenue(tariffCalc, Number(form.returnsCount || 0));
    const actualCash = Number(form.cashAmount || 0) + Number(form.mobileAmount || 0);
    const difference = Math.round((actualCash - netRevenue) * 100) / 100;
    return { calculatedRevenue, actualCash, difference };
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
    setSubmitError(null);

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
        cashAmount: Number(form.cashAmount || 0),
        mobileAmount: Number(form.mobileAmount || 0),
        readings,
      };
    });

    const payload = {
      zoneSubmissions,
      expenses: expenses
        .filter((e) => e.amount)
        .map((e) => ({
          zoneId: e.zoneId,
          amount: Number(e.amount),
          comment: e.comment,
          categoryId: e.categoryId || null,
        })),
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
      };
    });

    async function queueForLater() {
      await queueSubmission(payload);
      setResult({ summary: clientSummary });
      setQueued(true);
      setSubmitting(false);
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
        setSubmitError(data.error ?? "Не удалось отправить сдачу итогов");
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
      subtitle: new Date().toLocaleString(locale),
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
                  <span className="tabular-nums font-semibold">
                    {t.operatorApp.submit.difference} {s.difference > 0 ? "+" : ""}
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
          <button
            type="button"
            onClick={stepIndex === 0 ? () => router.push("/operator") : goBack}
            className="flex items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {stepIndex === 0 ? t.operatorApp.submit.cancelWizard : t.common.back}
          </button>
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
                    <PressableScale key={zone.id}>
                      <button
                        type="button"
                        onClick={() => toggleZone(zone.id)}
                        className={cn(
                          "relative flex w-full flex-col items-center gap-2.5 rounded-card border-[1.5px] px-3 py-5 text-center",
                          selected ? "border-primary bg-primary/10" : "border-border bg-card"
                        )}
                      >
                        {selected && (
                          <span className="absolute right-2.5 top-2.5 flex size-5.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" />
                          </span>
                        )}
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
                  : isStaysZone(activeZone) || isLaunchesZone(activeZone)
                    ? t.operatorApp.submit.gameRoomSub
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

            {activeZone.accountingMode !== "cash_only" && !isStaysZone(activeZone) && !isLaunchesZone(activeZone) && (
            <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
              {activeZone.assets.map((asset) => {
                const filled = isAssetFilled(activeZone, asset, activeForm);
                return (
                  <PressableScale key={asset.id}>
                    <button
                      type="button"
                      onClick={() => setAssetSheetId(asset.id)}
                      className={cn(
                        "relative flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left",
                        filled ? "border-success" : "border-border",
                        !asset.active && "grayscale"
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
                        {filled && (
                          <span className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full bg-success text-success-foreground shadow-sm">
                            <Check className="size-3.5" />
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 p-3">
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
                  </PressableScale>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-card p-3.5">
              <p className="text-body-airbnb font-semibold">{t.operatorApp.submit.returnsLabel}</p>
              <div className="flex items-center overflow-hidden rounded-control border border-border">
                <button
                  type="button"
                  className="flex size-10 items-center justify-center bg-muted"
                  onClick={() =>
                    updateZoneField(
                      activeZone.id,
                      "returnsCount",
                      String(Math.max(0, Number(activeForm.returnsCount || 0) - 1))
                    )
                  }
                >
                  <Minus className="size-4" />
                </button>
                <span className="w-11 text-center text-[0.9375rem] font-bold tabular-nums">
                  {activeForm.returnsCount || 0}
                </span>
                <button
                  type="button"
                  className="flex size-10 items-center justify-center bg-muted"
                  onClick={() =>
                    updateZoneField(activeZone.id, "returnsCount", String(Number(activeForm.returnsCount || 0) + 1))
                  }
                >
                  <Plus className="size-4" />
                </button>
              </div>
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
                    <PressableScale key={asset.id}>
                      <button
                        type="button"
                        onClick={() => setAssetSheetId(asset.id)}
                        disabled={blocked}
                        className={cn(
                          "relative flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left",
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
                          {filled && (
                            <span className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full bg-success text-success-foreground shadow-sm">
                              <Check className="size-3.5" />
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 p-3">
                          <span className="text-[0.90625rem] font-bold tracking-[-0.01em]">{asset.name}</span>
                          <span className="text-xs leading-snug text-muted-foreground">
                            {filled ? (
                              <>
                                {t.operatorApp.submit.cashLabel} {entry?.cash || 0} · {t.operatorApp.submit.mobileLabel}{" "}
                                {entry?.mobile || 0}
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
                    </PressableScale>
                  );
                })}
              </div>
            )}

            {!isStaysZone(activeZone) && !isLaunchesZone(activeZone) && (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="cash">{t.operatorApp.submit.cashLabel}</Label>
                  <MoneyInput
                    id="cash"
                    scale="lg"
                    inputMode="numeric"
                    className="h-14 rounded-control bg-muted text-lg font-bold"
                    value={activeForm.cashAmount}
                    onChange={(e) => updateZoneField(activeZone.id, "cashAmount", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="mobile">{t.operatorApp.submit.mobileLabel}</Label>
                  <MoneyInput
                    id="mobile"
                    scale="lg"
                    inputMode="numeric"
                    className="h-14 rounded-control bg-muted text-lg font-bold"
                    value={activeForm.mobileAmount}
                    onChange={(e) => updateZoneField(activeZone.id, "mobileAmount", e.target.value)}
                  />
                </div>

                {activeZone.accountingMode !== "cash_only" &&
                  (() => {
                    const preview = previewFor(activeZone.id);
                    return (
                      preview && (
                        <p className="text-caption-airbnb tabular-nums">
                          {t.operatorApp.submit.calculatedRevenue} <Money value={preview.calculatedRevenue} /> ·{" "}
                          {t.operatorApp.submit.difference} {preview.difference > 0 ? "+" : ""}
                          <Money value={preview.difference} />
                        </p>
                      )
                    );
                  })()}
              </>
            )}
          </div>
        )}

        {currentStep.kind === "expenses" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.submit.expensesTitle}</h1>
            {expenses.map((expense, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-card border border-border bg-card p-3">
                {selectedZoneIds.length > 1 && (
                  <Select
                    value={expense.zoneId}
                    onValueChange={(v) => v && updateExpense(index, "zoneId", v)}
                    items={selectedZoneIds.map((zoneId) => ({
                      value: zoneId,
                      label: zones.find((z) => z.id === zoneId)?.name ?? zoneId,
                    }))}
                  >
                    <SelectTrigger className="h-10 bg-muted text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedZoneIds.map((zoneId) => (
                        <SelectItem key={zoneId} value={zoneId}>
                          {zones.find((z) => z.id === zoneId)?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <MoneyInput
                  scale="lg"
                  placeholder={t.operatorApp.submit.amountPlaceholder}
                  className="h-14 rounded-control bg-muted text-lg font-bold"
                  value={expense.amount}
                  onChange={(e) => updateExpense(index, "amount", e.target.value)}
                />
                {expenseCategories.length > 0 && (
                  <Select
                    value={expense.categoryId}
                    onValueChange={(v) => v && updateExpense(index, "categoryId", v)}
                    items={expenseCategories.map((c) => ({ value: c.id, label: c.name }))}
                  >
                    <SelectTrigger className="h-10 bg-muted text-sm">
                      <SelectValue placeholder={t.operatorApp.submit.categoryPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  placeholder={t.operatorApp.submit.commentPlaceholder}
                  className="rounded-control bg-muted"
                  value={expense.comment}
                  onChange={(e) => updateExpense(index, "comment", e.target.value)}
                />
                <Button
                  variant="link"
                  className="h-auto w-fit gap-1 p-0 text-destructive"
                  onClick={() => removeExpense(index)}
                >
                  <Trash2 className="size-4" />
                  {t.common.delete}
                </Button>
              </div>
            ))}
            <PressableScale className="w-fit">
              <Button variant="outline" className="gap-2 rounded-control border-border" onClick={addExpense}>
                <Plus className="size-4" />
                {t.operatorApp.submit.addExpense}
              </Button>
            </PressableScale>
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
                  className="flex flex-col gap-1 rounded-card border border-border bg-card p-3 text-body-airbnb"
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
                      <span className="tabular-nums font-semibold">
                        {t.operatorApp.submit.difference} {preview.difference > 0 ? "+" : ""}
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
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
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
              const actual = (Number(entry.cash) || 0) + (Number(entry.mobile) || 0);
              // Абонемент прибавляется к факту здесь же — та касса уже
              // получила эти деньги раньше, при пополнении абонемента, не
              // сейчас (тот же баг, найден пользователем 2026-07-18 на этой
              // самой плашке: "Разница" ложно показывала недостачу ровно на
              // абонементную сумму актива — тот же класс, что уже пофикшен
              // в lib/reports.ts/submit-results/counters-day/home-summary/
              // readings, просто пропущен здесь).
              const diff = Math.round((actual + (revenue?.abonementAmount ?? 0) - calculated) * 100) / 100;
              return (
                <>
                  {/* Разбивка Наличные/Безнал — справа от суммы, тот же паттерн,
                      что карточка "Бизнес: расходы и прибыль" на money/page.tsx
                      (запрос пользователя 2026-07-17). Общее правило для "За
                      вход" и "По факту", не только при ненулевых суммах —
                      показывается всегда, когда есть расчёт по активу. */}
                  <div className="flex items-start justify-between gap-2 rounded-control bg-muted p-3.5">
                    <div className="flex min-w-0 flex-col tabular-nums">
                      <span className="text-caption-airbnb text-muted-foreground">
                        {t.operatorApp.submit.calculatedRevenue}
                      </span>
                      <span className="text-xl font-extrabold leading-none tracking-[-0.02em]">
                        <Money value={calculated} />
                      </span>
                    </div>
                    {revenue && (
                      <div className="flex min-w-0 flex-col items-end gap-0.5 pt-1 text-right text-caption-airbnb tabular-nums">
                        <span>
                          {t.operatorApp.submit.cashLabel}:{" "}
                          <span className="font-bold text-foreground">
                            <Money value={revenue.cashAmount} />
                          </span>
                        </span>
                        <span>
                          {t.operatorApp.submit.mobileLabel}:{" "}
                          <span className="font-bold text-foreground">
                            <Money value={revenue.mobileAmount} />
                          </span>
                        </span>
                        {/* Третий способ оплаты — показывается только когда
                            есть чем (запрос пользователя 2026-07-17), в
                            отличие от наличных/безнала не захламляет sheet
                            у зон, где абонементом ещё не пользовались. */}
                        {revenue.abonementAmount > 0 && (
                          <span>
                            {t.operatorApp.abonement.paymentLabel}:{" "}
                            <span className="font-bold text-foreground">
                              <Money value={revenue.abonementAmount} />
                            </span>
                          </span>
                        )}
                      </div>
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
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="assetMobile">{t.operatorApp.submit.mobileLabel}</Label>
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
                    <PressableScale className="flex">
                      <SaveButton
                        className="h-full min-w-[5.5rem] rounded-control px-5 font-bold"
                        saved={assetSheetSaved}
                        onClick={() =>
                          pulseAssetSheet(() => {
                            confirmAssetCash(activeZone.id, activeAsset.id);
                            setAssetSheetId(null);
                          })
                        }
                      />
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
                  className="h-full min-w-[5.5rem] rounded-control px-5 font-bold"
                  saved={assetSheetSaved}
                  onClick={() => pulseAssetSheet(() => setAssetSheetId(null))}
                />
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>

      <ImageLightbox src={lightboxUrl} />
    </div>
  );
}
