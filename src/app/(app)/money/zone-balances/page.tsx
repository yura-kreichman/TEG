"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Coins, Gift, HandCoins, MapPin, Pencil, PiggyBank, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { usePersistedPointId } from "@/hooks/use-persisted-point-id";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PrintButton } from "@/components/print/print-button";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { formatTime } from "@/lib/datetime-format";
import { cn } from "@/lib/utils";
import { Money } from "@/components/money";
import { formatMoneyWithCurrency } from "@/lib/format";
import { distributeCollectionWhole } from "@/lib/collection-split";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useOwnerPrintAvailable } from "@/hooks/use-print";
import type { PrintDocumentData } from "@/lib/print/receipt-document";

interface ZoneBalance {
  zoneId: string;
  zoneName: string;
  zoneIconKey: string | null;
  pointId: string;
  pointName: string;
  balance: number;
}

interface PointTotal {
  pointId: string;
  pointName: string;
  total: number;
  abonementCashTotal: number;
  collectionAdvance: number;
}

interface CollectionEntry {
  id: string;
  occurredAt: string;
  // null — не зонная запись, а свип абонементов/товаров наличными точки
  // (lib/zone-balance.ts, collection_pool_sweep_abonement/_goods), "Аванс
  // инкассации" (collection_advance) или аванс/премия, забранные сотрудником
  // самостоятельно из кассы точки (advance_taken/bonus_taken) — клиент сам
  // подставляет переведённую подпись по значению pool.
  zoneName: string | null;
  pointName: string;
  amount: number;
  pool: "abonement" | "goods" | "advance" | "advance_taken" | "bonus_taken" | null;
  // Только у advance_taken/bonus_taken — кто забрал.
  operatorName?: string | null;
}

// Сентинелы для "Абонементы"/"Товары" в дропдауне "По кассам" (запрос
// пользователя 2026-07-22: "мне кажется что в этот dropdown надо давать
// абонементы и товары... чтобы Владелец в минус мог забрать деньги пока не
// внесли их итоги" — явный выбор цели, как у обычной кассы зоны, вместо
// автораспределения через "Аванс инкассации"). Не настоящие id зон — POST
// уходит в отдельный /api/points/[id]/collection/pool, не /api/zones/[id]/collection.
const ABONEMENT_POOL_ID = "__abonement__";
const GOODS_POOL_ID = "__goods__";

type CollectionMode = "zone" | "general";

export default function ZoneBalancesPage() {
  const router = useRouter();
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();
  const printAvailable = useOwnerPrintAvailable();
  const [checking, setChecking] = useState(true);
  const [zoneBalances, setZoneBalances] = useState<ZoneBalance[]>([]);
  const [pointTotals, setPointTotals] = useState<PointTotal[]>([]);
  // Одна точка за раз — типичный дропдаун наверху, если их больше одной
  // (запрос пользователя 2026-07-22: "не удобно" смотреть остатки/инкассации
  // всех точек вперемешку одним списком, тот же паттерн, что на /goods).
  const [points, setPoints] = useState<{ id: string; name: string; iconKey: string | null }[]>([]);
  const [pointId, setPointId] = usePersistedPointId();
  const [changeFundZoneId, setChangeFundZoneId] = useState<string | null>(null);
  const [changeFundAmount, setChangeFundAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { saved: changeFundSaved, pulse: changeFundPulse } = useSavePulse();
  const { saved: collectionSaved, pulse: collectionPulse } = useSavePulse();
  const { saved: editCollectionSaved, pulse: editCollectionPulse } = useSavePulse();

  // Инкассация владельцем (запрос пользователя 2026-07-15: "как и у
  // Сотрудника") — тот же выбор "по зонам"/"общая", что в PWA оператора
  // (см. operator/page.tsx), плюс выбор точки, если их у тенанта больше
  // одной (оператор привязан к одному устройству/точке, владельцу нужно
  // выбрать явно).
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionPointId, setCollectionPointId] = useState("");
  const [collectionMode, setCollectionMode] = useState<CollectionMode>("zone");
  const [collectionZoneId, setCollectionZoneId] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  // Уведомление, если инкассация довзыскала "пул" — аванс/премию, которые
  // сотрудник уже забрал с точки после прошлой инкассации (lib/zone-balance.ts,
  // найдено на реальных данных 2026-07-16: без этого владелец не понимал бы,
  // почему по зонам списалось больше введённой суммы).
  const [poolSettledToast, setPoolSettledToast] = useState<number | null>(null);
  // Аванс инкассации (lib/zone-balance.ts, "Аванс инкассации") — часть
  // введённой суммы, для которой сейчас нет остатка ни в одной зоне (запрос
  // пользователя 2026-07-22: физически перемешанные деньги, "не известно,
  // какие откуда"), отложена отдельно вместо размазывания по случайной зоне.
  const [advanceToast, setAdvanceToast] = useState<number | null>(null);
  // Модуль печати (запрос пользователя 2026-07-20) — слип инкассации, кнопка
  // печати по требованию сразу после успешной инкассации, никогда не
  // автоматически.
  const [lastCollection, setLastCollection] = useState<{ amount: number; pointName: string; zoneName: string | null } | null>(
    null
  );

  // Реестр инкассаций — перенесён сюда с отдельного экрана /money/collections
  // (запрос пользователя 2026-07-15: "весь раздел Инкассации переносим в
  // 'Остаток наличных по зонам'").
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [collections, setCollections] = useState<CollectionEntry[]>([]);

  // Правка/удаление ошибочно внесённой инкассации (запрос пользователя
  // 2026-07-15) — тот же паттерн, что у авансов/премий сотрудника
  // (operators/[id]/page.tsx: editingMoneyOp).
  const [editingCollection, setEditingCollection] = useState<CollectionEntry | null>(null);
  const [editCollectionAmount, setEditCollectionAmount] = useState("");
  const [editCollectionError, setEditCollectionError] = useState<string | null>(null);
  const [confirmDeleteCollection, setConfirmDeleteCollection] = useState(false);
  const [deletingCollection, setDeletingCollection] = useState(false);
  const { saved: deletedCollection, pulse: deleteCollectionPulse } = useSavePulse();

  function openCollectionEdit(c: CollectionEntry) {
    setEditingCollection(c);
    setEditCollectionAmount(String(c.amount));
    setEditCollectionError(null);
    setConfirmDeleteCollection(false);
  }

  async function submitCollectionEdit() {
    if (!editingCollection) return;
    setEditCollectionError(null);
    const res = await fetch(`/api/money/collections/${editingCollection.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(editCollectionAmount) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEditCollectionError(data.error ?? t.money.collectionSaveError);
      return;
    }
    await Promise.all([loadReport(), loadCollections()]);
    editCollectionPulse(() => setEditingCollection(null));
  }

  async function deleteCollection() {
    if (!editingCollection) return;
    setDeletingCollection(true);
    setEditCollectionError(null);
    const res = await fetch(`/api/money/collections/${editingCollection.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setEditCollectionError(data.error ?? t.money.deleteCollectionError);
      setDeletingCollection(false);
      return;
    }
    setDeletingCollection(false);
    await Promise.all([loadReport(), loadCollections()]);
    deleteCollectionPulse(() => setEditingCollection(null));
  }

  async function loadPoints() {
    const res = await fetch("/api/points");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    const list = data.points ?? [];
    setPoints(list);
    setPointId((prev) => prev ?? list[0]?.id ?? null);
  }

  async function loadReport() {
    const res = await fetch("/api/reports/money");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setZoneBalances(data.zoneBalances ?? []);
    setPointTotals(data.pointTotals ?? []);
    setChecking(false);
  }

  async function loadCollections() {
    if (!pointId) return;
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth() + 1;
    const res = await fetch(`/api/reports/money/collections?year=${year}&month=${month}&pointId=${pointId}`);
    if (res.ok) {
      const data = await res.json();
      setCollections(data.collections ?? []);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadPoints();
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth, pointId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleChangeFund(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!changeFundZoneId) return;

    const res = await fetch(`/api/zones/${changeFundZoneId}/change-fund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: changeFundAmount }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Не удалось провести размен");
      return;
    }
    await loadReport();
    changeFundPulse(() => {
      setChangeFundAmount("");
      setChangeFundZoneId(null);
    });
  }

  // Остатки/итог — только выбранной вверху точки (запрос пользователя
  // 2026-07-22: "не удобно" видеть все точки одним списком). total уже
  // включает остатки зон (с пуловой поправкой на забранные аванс/премию) И
  // абонементы наличными этой точки — тот же итог, что сложение всех строк
  // списка ниже, без повторного пересчёта.
  const currentPointTotal = pointTotals.find((p) => p.pointId === pointId) ?? null;
  const currentZoneBalances = zoneBalances.filter((z) => z.pointId === pointId);
  const zonesForCollectionPoint = zoneBalances.filter((z) => z.pointId === collectionPointId);

  function openCollection() {
    setCollectionPointId(pointId ?? points[0]?.id ?? "");
    setCollectionMode("zone");
    setCollectionZoneId("");
    setCollectionAmount("");
    setCollectionError(null);
    setCollectionOpen(true);
  }

  async function handleCollection(event: FormEvent) {
    event.preventDefault();
    setCollectionError(null);

    let res: Response | null;
    if (collectionMode === "general") {
      res = await fetch(`/api/points/${collectionPointId}/collection/general`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: collectionAmount }),
      });
    } else if (!collectionZoneId) {
      setCollectionError(t.operatorApp.selectZone);
      return;
    } else if (collectionZoneId === ABONEMENT_POOL_ID || collectionZoneId === GOODS_POOL_ID) {
      res = await fetch(`/api/points/${collectionPointId}/collection/pool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool: collectionZoneId === ABONEMENT_POOL_ID ? "abonement" : "goods",
          amount: collectionAmount,
        }),
      });
    } else {
      res = await fetch(`/api/zones/${collectionZoneId}/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: collectionAmount }),
      });
    }

    const data = await res.json();
    if (!res.ok) {
      setCollectionError(data.error ?? "Не удалось провести инкассацию");
      return;
    }
    if (data.settledPool > 0) {
      setPoolSettledToast(data.settledPool);
      setTimeout(() => setPoolSettledToast(null), 3000);
    }
    if (data.advance > 0) {
      setAdvanceToast(data.advance);
      setTimeout(() => setAdvanceToast(null), 4000);
    }
    const pointName = points.find((p) => p.id === collectionPointId)?.name ?? "";
    const zoneName =
      collectionMode !== "zone"
        ? null
        : collectionZoneId === ABONEMENT_POOL_ID
          ? t.money.abonementCashLabel
          : collectionZoneId === GOODS_POOL_ID
            ? t.goods.navLabel
            : (zonesForCollectionPoint.find((z) => z.zoneId === collectionZoneId)?.zoneName ?? null);
    await Promise.all([loadReport(), loadCollections()]);
    collectionPulse(() => {
      setCollectionOpen(false);
      setCollectionAmount("");
      if (printAvailable.available) {
        setLastCollection({ amount: Number(collectionAmount), pointName, zoneName });
      }
    });
  }

  function buildCollectionReceiptData(c: NonNullable<typeof lastCollection>): PrintDocumentData {
    return {
      title: t.money.collectionSlipTitle,
      subtitle: `${new Date().toLocaleString(locale)} · ${t.common.ownerLabel}`,
      sections: [
        {
          lines: [
            { label: t.money.pointLabel, value: c.pointName },
            ...(c.zoneName ? [{ label: t.operatorApp.cashPointLabel, value: c.zoneName }] : []),
          ],
        },
      ],
      totalLine: { label: t.money.collectionAmountLabel, value: formatMoneyWithCurrency(c.amount, locale, currency) },
    };
  }

  function isCalendarCurrentMonth() {
    const today = new Date();
    return (
      calendarMonth.getUTCFullYear() === today.getUTCFullYear() && calendarMonth.getUTCMonth() === today.getUTCMonth()
    );
  }

  function stepCalendarMonth(delta: number) {
    if (delta > 0 && isCalendarCurrentMonth()) return;
    const next = new Date(calendarMonth);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setCalendarMonth(next);
  }

  function formatGroupDate(dateStr: string) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return `${d.getUTCDate()} ${t.readings.monthsGenitive[d.getUTCMonth()]}`;
  }

  // Подпись строки реестра для нового типа "забрал сам" (запрос пользователя
  // 2026-07-25) — имя + Аванс/Премия, а не просто одно из двух: без имени
  // непонятно, кто именно взял, если сотрудников на точке несколько.
  function collectionEntryLabel(c: CollectionEntry): string {
    if (c.zoneName) return c.zoneName;
    if (c.pool === "abonement") return t.money.abonementCashLabel;
    if (c.pool === "goods") return t.goods.navLabel;
    if (c.pool === "advance") return t.money.collectionAdvanceLabel;
    if (c.pool === "advance_taken" || c.pool === "bonus_taken") {
      const kind = c.pool === "advance_taken" ? t.operatorApp.workTime.advanceFieldLabel : t.operatorApp.workTime.bonusFieldLabel;
      return c.operatorName ? `${c.operatorName} · ${kind}` : kind;
    }
    return "";
  }

  const collectionGroups: { date: string; items: CollectionEntry[] }[] = [];
  for (const c of collections) {
    const dateKey = c.occurredAt.slice(0, 10);
    const lastGroup = collectionGroups[collectionGroups.length - 1];
    if (lastGroup && lastGroup.date === dateKey) lastGroup.items.push(c);
    else collectionGroups.push({ date: dateKey, items: [c] });
  }

  if (checking) {
    return (
      <OwnerShell>
        <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
          <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
            <Skeleton className="h-4 w-28" />
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
            <SpringCard hover={false} animate={false} className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </SpringCard>
            <SpringCard hover={false} animate={false} className="flex flex-col gap-3">
              <Skeleton className="h-3 w-40" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </SpringCard>
          </div>
        </div>
      </OwnerShell>
    );
  }

  const activeZoneName = zoneBalances.find((z) => z.zoneId === changeFundZoneId)?.zoneName;
  const calYear = calendarMonth.getUTCFullYear();
  const calMonth = calendarMonth.getUTCMonth() + 1;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
          <Link href="/money" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.money.title}
          </Link>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.money.zoneBalancesLink}</h1>
            <PressableScale>
              <Button
                variant="outline"
                size="sm"
                className="h-auto min-w-0 shrink items-start gap-1.5 whitespace-normal px-2.5 py-1.5 text-left leading-tight"
                onClick={openCollection}
              >
                <Plus className="size-4 shrink-0" />
                {t.money.recordCollectionButton}
              </Button>
            </PressableScale>
          </div>

          {points.length > 1 && (
            <Select
              value={pointId ?? null}
              onValueChange={(v) => v && setPointId(v)}
              items={points.map((p) => ({ value: p.id, label: p.name }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    {(() => {
                      const iconKey = points.find((p) => p.id === pointId)?.iconKey;
                      return iconKey ? (
                        <AssetOrZoneIcon iconKey={iconKey} className="size-5 shrink-0 text-muted-foreground" />
                      ) : (
                        <MapPin className="size-5 shrink-0 text-muted-foreground" />
                      );
                    })()}
                    {points.find((p) => p.id === pointId)?.name}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {points.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      {p.iconKey ? (
                        <AssetOrZoneIcon iconKey={p.iconKey} className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <MapPin className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Итог выбранной точки — акцентная плашка (запрос пользователя
              2026-07-21), тот же паттерн, что "Итоги дня" в money/readings —
              крупный масштабируемый Money size="display" под подписью. Аванс
              инкассации — второй, второстепенный показатель в той же плашке
              (запрос пользователя 2026-07-22: "может отображаться на синей
              плашке, где Итог"), у правого края, мельче и приглушённее —
              не наравне с "Итог", а справочно (тот же запрос: "сделай сумму
              меньше и выравняй по правому краю, а не рядом с Итогом"). */}
          <SpringCard hover={false} className="flex items-start justify-between gap-3 border-primary/20 bg-primary/10">
            <div className="flex flex-col">
              <span className="text-caption-airbnb text-muted-foreground">{t.money.zoneBalancesTotalLabel}</span>
              <span className="text-[2.75rem] font-extrabold leading-none tracking-[-0.02em] text-primary">
                <Money value={currentPointTotal?.total ?? 0} size="display" />
              </span>
            </div>
            {currentPointTotal && currentPointTotal.collectionAdvance > 0 && (
              <div className="flex shrink-0 flex-col items-end text-right">
                <span className="flex items-center gap-1 text-caption-airbnb text-muted-foreground">
                  <PiggyBank className="size-3.5 shrink-0" />
                  {t.money.collectionAdvanceLabel}
                </span>
                <span className="text-[1.0625rem] font-bold tabular-nums text-primary/70">
                  <Money value={currentPointTotal.collectionAdvance} />
                </span>
              </div>
            )}
          </SpringCard>

          <SpringCard hover={false} className="flex flex-col gap-1">
            {(() => {
              // Аванс/премия, которые сотрудник забрал сам с момента последней
              // инкассации (getPointCashBalance в lib/zone-balance.ts), физически
              // выходят из касс конкретных зон, просто система не знает, из
              // какой именно — поэтому на экране распределяем это списание по
              // зонам пропорционально их текущим остаткам, тем же алгоритмом,
              // что и разбивка "общей" инкассации (запрос пользователя
              // 2026-07-16: "после того, как Женя забрал остатки, по точке
              // должны быть 0" — должны обнулиться сами цифры зон, а не только
              // невидимый общий итог).
              const zonesRawSum = currentZoneBalances.reduce((sum, z) => sum + z.balance, 0);
              // Абонементные продажи наличными выделены в свою строку ниже
              // (запрос пользователя 2026-07-18) — вычитаем их из pool, иначе
              // они продолжали бы молча размазываться по остаткам зон как
              // будто это аванс/премия, которую забрал сотрудник.
              const pool = currentPointTotal
                ? Math.round((currentPointTotal.total - zonesRawSum - currentPointTotal.abonementCashTotal) * 100) / 100
                : 0;
              const allocation =
                pool !== 0
                  ? distributeCollectionWhole(
                      Math.abs(pool),
                      currentZoneBalances.map((z) => z.balance)
                    )
                  : currentZoneBalances.map(() => 0);
              const poolSign = Math.sign(pool);

              return (
              <>
                {currentZoneBalances.map((zb, i) => {
                  const displayBalance = Math.round((zb.balance + poolSign * allocation[i]) * 100) / 100;
                  return (
                  <div
                    key={zb.zoneId}
                    className="flex items-center justify-between border-t border-border py-3 pl-1 first:border-t-0"
                  >
                    <p className="text-body-airbnb">{zb.zoneName}</p>
                    <div className="flex items-center gap-3.5">
                      <span
                        className={cn(
                          "text-[0.96875rem] font-bold tabular-nums",
                          displayBalance === 0 && "font-medium text-muted-foreground"
                        )}
                      >
                        <Money value={displayBalance} />
                      </span>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                        onClick={() => {
                          setChangeFundZoneId(zb.zoneId);
                          setChangeFundAmount("");
                          setError(null);
                        }}
                      >
                        <Coins className="size-3.5" />
                        {t.money.changeFund}
                      </button>
                    </div>
                  </div>
                  );
                })}
                {/* Абонементы, проданные наличными на этой точке, ещё не
                    инкассированные — своя явная строка, не смешанная с
                    остатками зон (запрос пользователя 2026-07-18: "выделить
                    абонементные деньги из общего pool"). */}
                {currentPointTotal && currentPointTotal.abonementCashTotal > 0 && (
                  <div className="flex items-center justify-between border-t border-border py-3 pl-1">
                    <p className="flex items-center gap-1.5 text-body-airbnb">
                      <Gift className="size-4 shrink-0 text-muted-foreground" />
                      {t.money.abonementCashLabel}
                    </p>
                    <span className="text-[0.96875rem] font-bold tabular-nums">
                      <Money value={currentPointTotal.abonementCashTotal} />
                    </span>
                  </div>
                )}
              </>
              );
            })()}
          </SpringCard>

          <SpringCard hover={false} className="flex flex-col gap-3">
            <span className="text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
              {t.money.collectionsRegisterTitle}
            </span>
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label={t.readings.prevMonth}
                onClick={() => stepCalendarMonth(-1)}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
              >
                <ChevronLeft className="size-4.5" />
              </button>
              <p className="text-card-title">
                {t.readings.months[calMonth - 1]} {calYear}
              </p>
              <button
                type="button"
                aria-label={t.readings.nextMonth}
                onClick={() => stepCalendarMonth(1)}
                disabled={isCalendarCurrentMonth()}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4.5" />
              </button>
            </div>
            {collectionGroups.length === 0 ? (
              <p className="text-caption-airbnb text-muted-foreground">{t.money.noCollections}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {collectionGroups.map((group) => (
                  <div key={group.date}>
                    <p className="mb-1 text-caption-airbnb font-semibold text-muted-foreground">
                      {formatGroupDate(group.date)}
                    </p>
                    <div className="flex flex-col">
                      {group.items.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
                        >
                          <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                            {c.pool === "abonement" && <Gift className="size-3 shrink-0" />}
                            {c.pool === "goods" && <ShoppingBag className="size-3 shrink-0" />}
                            {c.pool === "advance" && <PiggyBank className="size-3 shrink-0" />}
                            {(c.pool === "advance_taken" || c.pool === "bonus_taken") && (
                              <HandCoins className="size-3 shrink-0" />
                            )}
                            {formatTime(c.occurredAt)} · {collectionEntryLabel(c)}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span
                              className={cn(
                                "text-xs font-bold tabular-nums",
                                c.pool === "advance_taken" && "text-warning",
                                c.pool === "bonus_taken" && "text-success"
                              )}
                            >
                              <Money value={c.amount} />
                            </span>
                            {/* "Забрал сам" — не редактируется отсюда (нет
                                соответствующего эндпоинта, правка/удаление
                                живёт на карточке сотрудника, "Авансы и
                                премии") — эта строка тут только для
                                прозрачности, откуда взялась просадка по
                                зонам. */}
                            {c.pool !== "advance_taken" && c.pool !== "bonus_taken" && (
                              <PressableScale>
                                <button
                                  type="button"
                                  onClick={() => openCollectionEdit(c)}
                                  aria-label={t.money.editCollectionAction}
                                  className="flex items-center justify-center rounded-full border border-border bg-card p-1.5 text-muted-foreground"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              </PressableScale>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SpringCard>
        </div>
      </div>

      <BottomSheet open={changeFundZoneId !== null} onClose={() => setChangeFundZoneId(null)}>
        <form onSubmit={handleChangeFund} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {t.money.changeFundAmountFor} «{activeZoneName}»
          </h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="changeFundAmount">{t.money.amountLabel}</Label>
            <div className="flex items-center gap-2">
              <MoneyInput
                id="changeFundAmount"
                autoFocus
                className="h-12 flex-1"
                value={changeFundAmount}
                onChange={(e) => setChangeFundAmount(e.target.value)}
                required
              />
              <PressableScale>
                <SaveButton type="submit" className="h-12" saved={changeFundSaved} />
              </PressableScale>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </BottomSheet>

      <BottomSheet open={collectionOpen} onClose={() => setCollectionOpen(false)}>
        <form onSubmit={handleCollection} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.collection}</h2>
          {/* Своего выбора точки внутри шита больше нет (запрос пользователя
              2026-07-22: "по идее здесь вообще не нужен") — форма всегда
              действует в рамках точки, выбранной дропдауном наверху страницы
              (openCollection проставляет collectionPointId = pointId). */}
              {/* Тумблер всегда виден, не только когда зон больше одной — целей для
                  "По кассам" теперь минимум три: любая зона + Абонементы + Товары
                  (запрос пользователя 2026-07-22). */}
              <SegmentedTabs
                shape="control"
                options={[
                  { key: "zone" as const, label: t.operatorApp.collectionModeZone },
                  { key: "general" as const, label: t.operatorApp.collectionModeGeneral },
                ]}
                value={collectionMode}
                onChange={setCollectionMode}
              />

              {collectionMode === "zone" ? (
                <div className="flex flex-col gap-1">
                  <Select
                    value={collectionZoneId || null}
                    onValueChange={(v) => setCollectionZoneId(v ?? "")}
                    items={[
                      ...zonesForCollectionPoint.map((z) => ({ value: z.zoneId, label: z.zoneName })),
                      { value: ABONEMENT_POOL_ID, label: t.money.abonementCashLabel },
                      { value: GOODS_POOL_ID, label: t.goods.navLabel },
                    ]}
                  >
                    <SelectTrigger id="collectionZone">
                      {(() => {
                        if (collectionZoneId === ABONEMENT_POOL_ID) {
                          return (
                            <SelectValue>
                              <span className="flex items-center gap-2">
                                <Gift className="size-5 shrink-0 text-muted-foreground" />
                                {t.money.abonementCashLabel}
                              </span>
                            </SelectValue>
                          );
                        }
                        if (collectionZoneId === GOODS_POOL_ID) {
                          return (
                            <SelectValue>
                              <span className="flex items-center gap-2">
                                <ShoppingBag className="size-5 shrink-0 text-muted-foreground" />
                                {t.goods.navLabel}
                              </span>
                            </SelectValue>
                          );
                        }
                        const current = zonesForCollectionPoint.find((z) => z.zoneId === collectionZoneId);
                        if (!current) return <SelectValue placeholder={t.operatorApp.selectZone} />;
                        return (
                          <SelectValue>
                            <span className="flex items-center gap-2">
                              {current.zoneIconKey ? (
                                <AssetOrZoneIcon iconKey={current.zoneIconKey} className="size-5 shrink-0" />
                              ) : (
                                <MapPin className="size-5 shrink-0 text-muted-foreground" />
                              )}
                              {current.zoneName}
                            </span>
                          </SelectValue>
                        );
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      {zonesForCollectionPoint.map((z) => (
                        <SelectItem key={z.zoneId} value={z.zoneId}>
                          <span className="flex items-center gap-2">
                            {z.zoneIconKey ? (
                              <AssetOrZoneIcon iconKey={z.zoneIconKey} className="size-5 shrink-0" />
                            ) : (
                              <MapPin className="size-5 shrink-0 text-muted-foreground" />
                            )}
                            {z.zoneName}
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem value={ABONEMENT_POOL_ID}>
                        <span className="flex items-center gap-2">
                          <Gift className="size-5 shrink-0 text-muted-foreground" />
                          {t.money.abonementCashLabel}
                        </span>
                      </SelectItem>
                      <SelectItem value={GOODS_POOL_ID}>
                        <span className="flex items-center gap-2">
                          <ShoppingBag className="size-5 shrink-0 text-muted-foreground" />
                          {t.goods.navLabel}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-caption-airbnb">{t.operatorApp.collectionGeneralHint}</p>
              )}

              <div className="flex flex-col gap-1">
                <Label htmlFor="collectionAmount">
                  {collectionMode === "general" ? t.money.collectionGeneralAmountLabel : t.money.collectionAmountLabel}
                </Label>
                <div className="flex items-center gap-2">
                  <MoneyInput
                    id="collectionAmount"
                    autoFocus
                    className="h-12 flex-1"
                    value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value)}
                    required
                  />
                  <PressableScale>
                    <SaveButton type="submit" className="h-12" saved={collectionSaved} />
                  </PressableScale>
                </div>
              </div>
              {collectionError && <p className="text-sm text-destructive">{collectionError}</p>}
        </form>
      </BottomSheet>

      {/* Слип инкассации — печать по требованию (модуль печати, запрос
          пользователя 2026-07-20), сразу после успешной инкассации. */}
      <BottomSheet open={lastCollection !== null} onClose={() => setLastCollection(null)}>
        {lastCollection && (
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.money.collectionDoneTitle}</h2>
            <p className="text-body-airbnb text-muted-foreground">
              {lastCollection.pointName}
              {lastCollection.zoneName ? ` · ${lastCollection.zoneName}` : ""} · <Money value={lastCollection.amount} />
            </p>
            {printAvailable.available && (
              <PrintButton
                label={t.money.printCollectionSlipButton}
                data={buildCollectionReceiptData(lastCollection)}
                branding={printAvailable.branding}
                className="w-full gap-1.5 rounded-lg"
              />
            )}
            <PressableScale className="w-full">
              <Button type="button" variant="outline" className="h-11 w-full rounded-lg" onClick={() => setLastCollection(null)}>
                {t.common.close}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={editingCollection !== null} onClose={() => setEditingCollection(null)}>
        {editingCollection && (
          <div className="flex flex-col gap-4 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.collection}</h2>
            <div className="flex flex-col gap-1">
              <Label htmlFor="editCollectionAmount">{t.money.amountLabel}</Label>
              <div className="flex items-center gap-2">
                <MoneyInput
                  id="editCollectionAmount"
                  autoFocus
                  scale="lg"
                  className="h-14 flex-1 text-lg"
                  value={editCollectionAmount}
                  onChange={(e) => setEditCollectionAmount(e.target.value)}
                />
                <PressableScale>
                  <SaveButton className="h-14" onClick={submitCollectionEdit} saved={editCollectionSaved} />
                </PressableScale>
              </div>
            </div>
            {editCollectionError && <p className="text-sm text-destructive">{editCollectionError}</p>}

            {confirmDeleteCollection ? (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-body-airbnb">{t.money.deleteCollectionConfirm}</p>
                <PressableScale>
                  <DeleteButton
                    className="h-12 w-full"
                    disabled={deletingCollection}
                    onClick={deleteCollection}
                    deleted={deletedCollection}
                  />
                </PressableScale>
              </div>
            ) : (
              <div className="border-t border-border pt-4">
                <PressableScale>
                  <Button variant="destructive" className="w-full gap-1.5" onClick={() => setConfirmDeleteCollection(true)}>
                    <Trash2 className="size-4" />
                    {t.common.delete}
                  </Button>
                </PressableScale>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {poolSettledToast !== null && (
        <div className="fixed bottom-24 left-1/2 z-70 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-caption-airbnb font-semibold text-background shadow-lg">
          {t.money.collectionPoolSettledPrefix} <Money value={poolSettledToast} /> {t.money.collectionPoolSettledSuffix}
        </div>
      )}
      {advanceToast !== null && (
        <div className="fixed bottom-24 left-1/2 z-70 -translate-x-1/2 max-w-[calc(100vw-2rem)] rounded-full bg-foreground px-4 py-2 text-center text-caption-airbnb font-semibold text-background shadow-lg">
          {t.money.collectionAdvanceToastPrefix} <Money value={advanceToast} /> {t.money.collectionAdvanceToastSuffix}
        </div>
      )}
    </OwnerShell>
  );
}
