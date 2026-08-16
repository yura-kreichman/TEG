"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  FileText,
  Gift,
  Info,
  Lock,
  MapPin,
  Minus,
  Pencil,
  Plus,
  RefreshCcw,
  ShoppingBag,
  ShoppingCart,
  TicketCheck,
  Trash2,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { BackLink } from "@/components/back-link";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { InfoTooltip } from "@/components/info-tooltip";
import { Skeleton, SkeletonListRows } from "@/components/ui/skeleton";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconActionButton } from "@/components/kebab-menu";
import { ConfirmIconButton } from "@/components/confirm-icon-button";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { PaymentMethodIcon } from "@/components/payment-method-icon";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { DeleteButton } from "@/components/ui/delete-button";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { SaveButton } from "@/components/ui/save-button";
import { usePersistedPointId } from "@/hooks/use-persisted-point-id";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n, useLocale } from "@/components/i18n-provider";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PerformedByTag } from "@/components/performed-by-tag";
import { calcSessions, calcZoneGrossRevenue, calcZoneRevenue, type ZoneAccountingMode } from "@/lib/results-calc";
import { formatMoney, parseMoneyInput } from "@/lib/format";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { formatTime, pad } from "@/lib/datetime-format";

interface PointOption {
  id: string;
  name: string;
  iconKey: string | null;
}

interface DayAssetReading {
  tariffId: string;
  tariffName: string;
  previousValue: number | null;
  value: number;
  sessions: number;
  editedBefore: number | null;
}

interface DayCard {
  zoneSubmissionId: string;
  zoneId: string;
  zoneName: string;
  zoneIconKey: string | null;
  accountingMode: ZoneAccountingMode;
  submittedAt: string;
  operatorName: string;
  operatorColorTag: string | null;
  editable: boolean;
  edited: { at: string; reason: string | null } | null;
  cashAmount: number;
  cashEditedBefore: number | null;
  mobileAmount: number;
  abonementAmount: number;
  // Часть abonementAmount, которая участвует в Разнице — правило выбора живёт
  // на сервере (countersPaidFromBalance), клиент его больше не повторяет.
  abonementInDifference: number;
  returnsCount: number;
  // Отдельные события тестовых прогонов, из которых сложился returnsCount
  // выше (см. returnEventsBySubmission в /api/reports/counters/day).
  // Необязательное намеренно: тип описывает разобранный JSON, а не гарантию
  // сервера — карточка из прошлой версии API (кеш браузера, недокатившийся
  // деплой) не должна ронять весь экран, как это случилось 2026-08-04.
  returnEvents?: {
    occurredAt: string;
    performedBy: string | null;
    performedByOwner: boolean;
    performedByColorTag: string | null;
  }[];
  calculatedRevenue: number;
  netRevenue: number;
  difference: number;
  tariffs: { tariffId: string; price: number }[];
  assets: {
    assetId: string;
    assetName: string;
    colorTag: string;
    photoUrl: string | null;
    iconKey: string | null;
    readings: DayAssetReading[];
  }[];
  // "Прибывания"/тап-"Пуски" — из Launch, не из assetReadings, отдельное
  // поле вместо переиспользования "assets" выше: форма другая (count+amount,
  // без "было→стало", у пусков нет непрерывного счётчика).
  liveAssets: {
    assetId: string;
    assetName: string;
    colorTag: string;
    photoUrl: string | null;
    iconKey: string | null;
    count: number;
    amount: number;
  }[];
  // Поштучный список пусков окна — для аннулирования владельцем прямо в
  // карточке (запрос "выполни всё" по аудиту 2026-07-25: у "Прибываний"/
  // тап-"Пусков" не было способа исправить ошибочный/тестовый пуск, в
  // отличие от Билетов).
  liveLaunches: {
    id: string;
    assetId: string;
    assetName: string;
    startedAt: string;
    endedAt: string | null;
    amount: number;
    paymentMethod: string | null;
  }[];
  // Билеты (docs/spec/10-tickets.md, "Отчёты") — только у accountingMode
  // "tickets", null у остальных режимов. ticketAssets — разрез по активам и
  // вариантам (заказ мультиактивный, поэтому не переиспользует ни assets,
  // ни liveAssets выше — своя форма без "было→стало" и без единого actives,
  // одна строка на КОМБИНАЦИЮ актив+вариант).
  ticketsOrdersCount: number | null;
  ticketsCount: number | null;
  ticketsRedeemedCount: number | null;
  ticketsExpiredCount: number | null;
  ticketRedemptionEnabled: boolean | null;
  ticketAssets: { assetId: string; assetName: string; variantName: string; count: number; amount: number }[];
  // Заказы окна — для аннулирования владельцем прямо в карточке (запрос
  // пользователя 2026-07-21).
  ticketOrders: {
    id: string;
    number: number;
    paymentMethod: string;
    totalSnapshot: number;
    expiresAt: string | null;
    soldAt: string;
    soldByOperatorName: string;
    soldByOperatorColorTag: string | null;
    tickets: {
      id: string;
      assetId: string;
      assetName: string;
      variantNameSnapshot: string;
      priceSnapshot: number;
      status: string;
      redeemedAt: string | null;
      redeemedByOperatorName: string | null;
      redeemedByOperatorColorTag: string | null;
    }[];
  }[];
}

// Продажи абонементов за день — независимый от зон "карман" (запрос
// пользователя 2026-07-18), items по аналогии с активами: план+цена+способ
// оплаты+количество, вместо одной плоской суммы.
interface AbonementSales {
  cash: number;
  mobile: number;
  items: {
    abonementId: string;
    name: string | null;
    cashAmount: number;
    cashCount: number;
    mobileAmount: number;
    mobileCount: number;
  }[];
}

// Сверки кассы Товаров за день (запрос пользователя 2026-07-31) — отдельная
// карточка ниже, по тому же принципу, что и "Продажи абонементов": деньги не
// привязаны ни к одной зоне, не входят в Расчёт/Разницу зон выше. НЕ
// привязано к режиму учёта "Счётчики" — Товары доступны на точке независимо
// от того, какие режимы учёта у её зон (уточнение пользователя 2026-07-31),
// поэтому карточка показывается всегда, когда за день была хотя бы одна
// сверка, вне зависимости от cards/accountingMode.
// Кто кому начислил абонемент (запрос пользователя 2026-08-04). creditedAmount
// — ЗАЧИСЛЕННАЯ сумма с бонусом плана, не уплаченные деньги: те в итогах выше.
interface AbonementSaleEvent {
  id: string;
  occurredAt: string;
  creditedAmount: number;
  paymentMethod: string | null;
  planName: string | null;
  clientName: string | null;
  clientPhone: string | null;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByColorTag: string | null;
}

// Кто кому продал товар. clientName заполнен не всегда — при оплате наличными
// без привязки к клиенту его просто нет, и это честное "—".
// Расходы дня — плоский список операций журнала за выбранную дату (запрос
// владельца 2026-08-16). В арифметику кассы/разницы не входят: деньги ушли
// ПОСЛЕ того, как попали в кассу, и вычитание их из фактической кассы
// показывало бы недостачу там, где всё сходится.
interface DayExpenses {
  total: number;
  items: {
    id: string;
    occurredAt: string;
    amount: number;
    zoneId: string | null;
    zoneName: string;
    categoryName: string | null;
    comment: string | null;
    operatorName: string | null;
  }[];
}

interface GoodsSaleEntry {
  id: string;
  occurredAt: string;
  goodsName: string | null;
  quantity: number;
  amount: number;
  paymentMethod: string;
  clientName: string | null;
  clientPhone: string | null;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByColorTag: string | null;
}

interface GoodsReconciliationEntry {
  id: string;
  occurredAt: string;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByColorTag: string | null;
  actualCash: number;
  actualMobile: number;
  calculatedCash: number;
  calculatedMobile: number;
  calculatedAbonement: number;
  difference: number;
}

type ActionsView = "edit" | "confirm-delete";

// "Возвраты/тестовые" содержательны только у "Счётчиков" и у legacy
// "Пусков" на показаниях (assets.length > 0 — сейчас такие уже не
// создаются, тап-"Пуски" не пишут assetReadings, только Launch): у Билетов
// эту роль играет аннулирование (docs/spec/10-tickets.md, "Отчёты", п.3), у
// "Прибываний" и тап-"Пусков" возвратов как понятия нет вовсе, а у
// cash_only — нет ни тарифов, ни выручки для вычета. Тот же isLiveZone, что
// уже использует computeEditPreview ниже — общий helper, чтобы условие
// видимости строки "Возвраты" (агрегат дня, карточка зоны, форма
// редактирования) не расходилось по трём копиям, как было до аудита
// 2026-07-22 (агрегат вообще не исключал tickets, форма редактирования не
// исключала stays/тап-launches — все три места показывали "Возвраты: 0" без
// какого-либо эффекта на Расчёт/Разницу).
function returnsApplicable(card: Pick<DayCard, "accountingMode" | "assets">): boolean {
  return card.accountingMode === "counters" || (card.accountingMode === "launches" && card.assets.length > 0);
}

// "counters" — единственный режим, где locked означает "не последнее звено
// цепочки показаний" (t.readings.lockedNote); у остальных не-cash_only
// режимов locked теперь означает "этот режим вообще не редактируется/не
// удаляется" (isZoneSubmissionEditable, аудит 2026-07-24) — разная причина
// требует разного текста, иначе подпись вводит владельца в заблуждение
// ("есть более поздняя сдача", хотя дело не в этом).
function lockedNoteFor(card: Pick<DayCard, "accountingMode">, t: Dictionary): string {
  return card.accountingMode === "counters" ? t.readings.lockedNote : t.readings.lockedNoteMode;
}

// Порог сворачивания (решение пользователя 2026-08-04): список из трёх строк
// и короче остаётся раскрытым — прятать его значило бы добавить тап на ровном
// месте. Правило общее для всех блоков и всех режимов учёта, а не настройка
// под каждый: у "Счётчиков" активы идут с подсписком тарифов и список длинный,
// у "Прибываний"/тап-"Пусков" — одна строка на актив, и сворачивать нечего.
// Так владельцу не приходится гадать, почему у одной зоны свёрнуто, а у
// соседней нет — решает длина, а не режим.
const COLLAPSE_FROM_ROWS = 4;

/**
 * Погашенные билеты окна — те самые, что уже посчитаны в "Погашено X из Y"
 * (см. aggregateTicketOrders): билеты заказов ЭТОГО окна со статусом
 * "redeemed", независимо от того, когда именно их погасили. Считается из уже
 * загруженных заказов, без отдельного запроса — список и число обязаны
 * сходиться, а для этого им нужен один источник.
 */
function redeemedTicketsOf(card: DayCard) {
  return card.ticketOrders
    .flatMap((o) => o.tickets)
    .filter((tk) => tk.status === "redeemed")
    .sort((a, b) => (a.redeemedAt ?? "").localeCompare(b.redeemedAt ?? ""));
}

/**
 * Сворачиваемый блок "Итогов дня" — общий для активов, тестовых прогонов,
 * продаж абонементов и продаж товаров (запрос пользователя 2026-08-04:
 * "чтобы не было очень громоздко"). Один компонент на все четыре места
 * специально: они должны вести себя одинаково, иначе экран снова расползётся
 * на четыре разных представления о том, что такое "раскрыть".
 */
function CollapsibleRows({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count < COLLAPSE_FROM_ROWS);
  if (count === 0) return null;

  // Короткий список рисуем без кнопки вовсе — сворачивать нечего, а лишний
  // интерактивный заголовок только шумит.
  if (count < COLLAPSE_FROM_ROWS) {
    return <div className="mt-1.5 flex flex-col">{children}</div>;
  }

  return (
    <div className="mt-1.5 flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 py-1.5 text-caption-airbnb"
      >
        <span className="flex items-center gap-1.5 font-semibold">
          {icon}
          {title}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="tabular-nums">{count}</span>
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  );
}

export default function ReadingsCalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useI18n();
  const locale = useLocale();
  const [checking, setChecking] = useState(true);
  const [points, setPoints] = useState<PointOption[]>([]);
  // Наследует выбор с главного экрана через ?pointId= (запрос пользователя
  // 2026-07-16), иначе — сохранённая точка (запрос пользователя 2026-07-19),
  // иначе — первая точка (loadPoints ниже), как и раньше.
  const [pointId, setPointId] = usePersistedPointId(searchParams.get("pointId"));

  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth() + 1); // 1-12

  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [cards, setCards] = useState<DayCard[] | null>(null);
  // Продажи абонементов за день — отдельный "карман", не привязанный ни к
  // одной зоне (запрос пользователя 2026-07-18), грузится вместе с cards.
  const [abonementSales, setAbonementSales] = useState<AbonementSales | null>(null);
  const [goodsReconciliations, setGoodsReconciliations] = useState<GoodsReconciliationEntry[]>([]);
  // Кто кому начислил абонемент и кто кому продал товар (запрос пользователя
  // 2026-08-04) — построчная детализация под уже существующими итогами.
  const [abonementSaleEvents, setAbonementSaleEvents] = useState<AbonementSaleEvent[]>([]);
  const [goodsSales, setGoodsSales] = useState<GoodsSaleEntry[]>([]);
  // Расходы дня (запрос владельца 2026-08-16) — считаются по времени операции,
  // не по привязке к сдаче итогов, поэтому приходят отдельным полем, а не
  // внутри карточек зон.
  const [expenses, setExpenses] = useState<DayExpenses>({ total: 0, items: [] });
  // Премии/авансы, взятые сотрудником из кассы точки за день — тот же состав,
  // что в сводке "Касса за день" (решение владельца 2026-08-16: Итоги дня
  // показывали грязную кассу и расходились со сводкой).
  const [payouts, setPayouts] = useState(0);
  // День последней сдачи итогов — открывается по умолчанию (запрос
  // пользователя 2026-07-15), а не сегодняшний пустой день. Резолвится один
  // раз на каждую смену точки, до первой загрузки календаря — иначе был бы
  // виден "прыжок" с текущего месяца на месяц последней сдачи (тот же приём,
  // что уже есть на /money). Сравнение с pointId, а не отдельный boolean —
  // иначе между сменой pointId и срабатыванием эффекта был бы один рендер
  // со старым dateReady=true и ещё не сброшенными year/month/selectedDate.
  const [dateReadyForPointId, setDateReadyForPointId] = useState<string | null | undefined>(undefined);
  const dateReady = dateReadyForPointId === pointId;

  const [actionsFor, setActionsFor] = useState<DayCard | null>(null);
  const [actionsView, setActionsView] = useState<ActionsView>("edit");
  const [editReadings, setEditReadings] = useState<Record<string, string>>({});
  const [editCash, setEditCash] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [editReturns, setEditReturns] = useState("");
  const [editReason, setEditReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { saved: readingDeleted, pulse: readingDeletePulse } = useSavePulse();
  const { saved: editSaved, pulse: editSavePulse } = useSavePulse();

  // Аннулирование билета/заказа прямо из карточки (запрос пользователя
  // 2026-07-21) — переиспользует уже существующие owner-only роуты
  // /api/tickets/[id]/void и /api/ticket-orders/[id]/void (docs/spec/10-
  // tickets.md, "АННУЛИРОВАНИЕ"). Просто мусорка с инлайн-подтверждением
  // "Точно?" (запрос пользователя 2026-07-21: "просто кнопка удалить") —
  // тот же ConfirmIconButton-паттерн, что уже у Сотрудника в
  // operator/tickets/page.tsx. Список заказов в самой карточке —
  // компактные строки (запрос пользователя 2026-07-22: "слишком большой,
  // нужно компактно... заходить внутрь"); поштучное аннулирование билетов —
  // внутри BottomSheet, открытого по конкретному заказу (viewOrderId).
  const [voidingTicket, setVoidingTicket] = useState<string | null>(null);
  const [voidingOrder, setVoidingOrder] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);

  async function voidTicket(orderId: string, ticketId: string) {
    setVoidingTicket(ticketId);
    setVoidError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/void`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setVoidError(data?.error ?? t.readings.saveError);
        return;
      }
      if (selectedDate) await loadDay(selectedDate);
    } finally {
      setVoidingTicket(null);
    }
  }

  async function voidOrder(orderId: string) {
    setVoidingOrder(orderId);
    setVoidError(null);
    try {
      const res = await fetch(`/api/ticket-orders/${orderId}/void`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setVoidError(data?.error ?? t.readings.saveError);
        return;
      }
      if (selectedDate) await loadDay(selectedDate);
    } finally {
      setVoidingOrder(null);
    }
  }

  // Аннулирование пуска — тот же ConfirmIconButton-паттерн, что у заказов
  // билетов выше (/api/launches/[id]/void).
  const [voidingLaunch, setVoidingLaunch] = useState<string | null>(null);

  async function voidLaunch(launchId: string) {
    setVoidingLaunch(launchId);
    setVoidError(null);
    try {
      const res = await fetch(`/api/launches/${launchId}/void`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setVoidError(data?.error ?? t.readings.saveError);
        return;
      }
      if (selectedDate) await loadDay(selectedDate);
    } finally {
      setVoidingLaunch(null);
    }
  }

  async function loadPoints() {
    const res = await fetch("/api/points");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    const list: PointOption[] = data.points ?? [];
    setPoints(list);
    setPointId((prev) => prev ?? list[0]?.id ?? null);
    setChecking(false);
  }

  async function loadCalendar() {
    if (!pointId) return;
    const res = await fetch(`/api/reports/counters/calendar?pointId=${pointId}&year=${year}&month=${month}`);
    if (!res.ok) return;
    const data = await res.json();
    setActiveDates(new Set<string>(data.activeDates ?? []));
  }

  async function loadDay(date: string) {
    if (!pointId) return;
    const res = await fetch(`/api/reports/counters/day?pointId=${pointId}&date=${date}`);
    if (!res.ok) return;
    const data = await res.json();
    setCards(data.cards ?? []);
    setAbonementSales(data.abonementSales ?? null);
    setGoodsReconciliations(data.goodsReconciliations ?? []);
    setAbonementSaleEvents(data.abonementSaleEvents ?? []);
    setGoodsSales(data.goodsSales ?? []);
    setExpenses(data.expenses ?? { total: 0, items: [] });
    setPayouts(data.payouts ?? 0);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pointId) {
      setDateReadyForPointId(null);
      return;
    }
    fetch(`/api/reports/counters/last-submission-date?pointId=${pointId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { date: string | null } | null) => {
        if (data?.date) {
          const d = new Date(`${data.date}T00:00:00Z`);
          setYear(d.getUTCFullYear());
          setMonth(d.getUTCMonth() + 1);
          setSelectedDate(data.date);
          setCards(null);
          loadDay(data.date);
        }
        setDateReadyForPointId(pointId);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId]);

  useEffect(() => {
    if (!dateReady) return;
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateReady, pointId, year, month]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openDay(date: string) {
    setSelectedDate(date);
    setCards(null);
    loadDay(date);
  }

  function goMonth(delta: number) {
    if (delta > 0 && year === today.getUTCFullYear() && month === today.getUTCMonth() + 1) return;
    let nextMonth = month + delta;
    let nextYear = year;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setMonth(nextMonth);
    setYear(nextYear);
  }

  // Прямые кнопки-иконки на строке вместо кебаб-меню (запрос пользователя
  // 2026-07-19: "здесь тоже вместо бургера можно поставить кнопки, как ты
  // сделал в Товарах... всего 2 опции") — actionsFor выставляется прямо тут,
  // не через промежуточный шаг "меню".
  function openEdit(card: DayCard) {
    const readings: Record<string, string> = {};
    for (const asset of card.assets) {
      for (const r of asset.readings) readings[`${asset.assetId}:${r.tariffId}`] = String(r.value);
    }
    setActionsFor(card);
    setEditReadings(readings);
    setEditCash(String(card.cashAmount));
    setEditMobile(String(card.mobileAmount));
    setEditReturns(String(card.returnsCount));
    setEditReason("");
    setActionError(null);
    setActionsView("edit");
  }

  function openDeleteConfirm(card: DayCard) {
    setActionsFor(card);
    setActionsView("confirm-delete");
    setActionError(null);
  }

  async function confirmEdit() {
    if (!actionsFor) return;
    const res = await fetch(`/api/reports/counters/zone-submission/${actionsFor.zoneSubmissionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        readings: Object.fromEntries(Object.entries(editReadings).map(([k, v]) => [k, Number(v)])),
        cashAmount: parseMoneyInput(editCash),
        mobileAmount: parseMoneyInput(editMobile),
        returnsCount: Number(editReturns || 0),
        reason: editReason,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error ?? t.readings.saveError);
      return;
    }
    if (selectedDate) await loadDay(selectedDate);
    editSavePulse(() => setActionsFor(null));
  }

  async function confirmDelete() {
    if (!actionsFor || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reports/counters/zone-submission/${actionsFor.zoneSubmissionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setActionError(data?.error ?? t.readings.deleteError);
        return;
      }
      if (selectedDate) await loadDay(selectedDate);
      await loadCalendar();
      readingDeletePulse(() => setActionsFor(null));
    } finally {
      setDeleting(false);
    }
  }

  // Итоговая сводка дня — сумма по всем зонам точки за выбранную дату (запрос
  // пользователя 2026-07-18: "рядом с Календарём") — та же арифметика, что и
  // в карточке каждой отдельной зоны ниже, просто сложенная по всем cards
  // разом, чтобы не листать каждую зону, чтобы увидеть общий итог дня.
  const daySummary = (cards ?? []).reduce(
    (acc, card) => ({
      cash: acc.cash + card.cashAmount,
      mobile: acc.mobile + card.mobileAmount,
      abonement: acc.abonement + card.abonementAmount,
      // Баланс прибавляется к "Фактической кассе" ровно там, где он учтён и
      // в Разнице — иначе "касса − расчёт" на экране не сходится с показанной
      // Разницей. Какая это часть, решает сервер (abonementInDifference).
      abonementInCash: acc.abonementInCash + card.abonementInDifference,
      calculatedRevenue: acc.calculatedRevenue + card.calculatedRevenue,
      returnsCount: acc.returnsCount + card.returnsCount,
      difference: Math.round((acc.difference + card.difference) * 100) / 100,
    }),
    { cash: 0, mobile: 0, abonement: 0, abonementInCash: 0, calculatedRevenue: 0, returnsCount: 0, difference: 0 }
  );

  if (checking || !dateReady) {
    return (
      <OwnerShell>
        <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
          <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
            <Skeleton className="mb-2 h-4 w-32" />
            <Skeleton className="mb-4 h-7 w-40" />
            <Skeleton className="mb-4 h-10" />
            <div className="flex flex-col gap-3.5">
              <SkeletonListRows count={3} />
            </div>
          </div>
        </div>
      </OwnerShell>
    );
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekdayIndex = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // 0=Mon
  const todayKey = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;

  // Compact calendar: no point showing empty future days, so the grid never
  // extends past today (and the current month is as far forward as nav goes).
  const isCurrentMonth = year === today.getUTCFullYear() && month === today.getUTCMonth() + 1;
  const isFutureMonth =
    year > today.getUTCFullYear() || (year === today.getUTCFullYear() && month > today.getUTCMonth() + 1);
  const lastVisibleDay = isFutureMonth ? 0 : isCurrentMonth ? today.getUTCDate() : daysInMonth;

  const cells: (string | null)[] = [
    ...Array(firstWeekdayIndex).fill(null),
    ...Array.from({ length: lastVisibleDay }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`),
  ];

  function formatReadableDate(dateStr: string) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const day = d.getUTCDate();
    const monthName = t.readings.monthsGenitive[d.getUTCMonth()];
    const weekday = t.readings.weekdaysFull[(d.getUTCDay() + 6) % 7];
    return `${day} ${monthName} (${weekday})`;
  }

  // Живой пересчёт Расчёта/Разницы в форме редактирования (запрос
  // пользователя 2026-07-15) — та же формула, что на сервере
  // (submit-results/route.ts), просто на драфте editReadings, не на
  // сохранённых значениях. "launches" — показание уже готовое число
  // заездов (не диапазон от предыдущего), "counters" — calcSessions с
  // переполнением через 9999.
  function computeEditPreview(card: DayCard) {
    const isLaunches = card.accountingMode === "launches";
    const sessionsByTariff = new Map<string, number>();
    for (const asset of card.assets) {
      for (const r of asset.readings) {
        const key = `${asset.assetId}:${r.tariffId}`;
        const raw = editReadings[key];
        const current = raw !== undefined && raw !== "" ? Number(raw) : r.value;
        const sessions = isLaunches ? current : calcSessions(current, r.previousValue ?? 0);
        sessionsByTariff.set(r.tariffId, (sessionsByTariff.get(r.tariffId) ?? 0) + sessions);
      }
    }
    const tariffCalc = card.tariffs.map((t) => ({
      tariffId: t.tariffId,
      price: t.price,
      sessions: sessionsByTariff.get(t.tariffId) ?? 0,
    }));
    // "Прибывания"/тап-"Пуски" не имеют показаний вообще (card.assets пуст) —
    // их выручка живёт в Launch, не пересчитывается на драфте (в этой форме
    // для них нет ничего "показаниевого" редактируемого, только
    // наличные/безнал/возвраты) — берём уже посчитанное сервером значение,
    // а не 0 из пустого tariffCalc (тот же реальный баг, найден пользователем
    // 2026-07-19, что и в самом /api/reports/counters/day).
    // Билеты — тоже "живая" зона в этом смысле: у неё нет показаний, редактируется
    // только касса, а calculatedRevenue считается по заказам, не по card.tariffs
    // (у tickets-зон он всегда пуст) — без этой ветки превью в форме
    // редактирования всегда показывало бы 0₽ (тот же класс бага, что уже
    // фиксился для мастера сдачи итогов, submit/page.tsx: reports/reports.ts;
    // найден при аудите 2026-07-21).
    const isLiveZone =
      card.accountingMode === "stays" || card.accountingMode === "tickets" || (isLaunches && card.assets.length === 0);
    // "Счёт." — всегда валовая выручка по счётчикам, ФАКТ (запрос пользователя
    // 2026-07-16). Разница считается от net (за вычетом тестов), с поправкой
    // на абонемент — та касса уже получила эти деньги раньше, при
    // пополнении, не сейчас (реальный баг, найден пользователем 2026-07-18:
    // без поправки разница ложно показывала недостачу ровно на сумму пусков,
    // оплаченных абонементом).
    const calculatedRevenue = isLiveZone ? card.calculatedRevenue : calcZoneGrossRevenue(tariffCalc);
    const netRevenue = isLiveZone ? card.netRevenue : calcZoneRevenue(tariffCalc, Number(editReturns || 0));
    const actualCash = parseMoneyInput(editCash) + parseMoneyInput(editMobile);
    // Какая часть баланса участвует в Разнице — решено на сервере
    // (countersPaidFromBalance); тут только применяем. Своя копия этого
    // правила жила здесь до 2026-08-13 и разошлась с сервером.
    const difference = Math.round((actualCash + card.abonementInDifference - netRevenue) * 100) / 100;
    return { calculatedRevenue, difference };
  }

  // Заказ, открытый в детальном BottomSheet (компактные строки заказов —
  // запрос пользователя 2026-07-22, "заходить внутрь"). Ищем по всем card —
  // не привязано к cardId, id заказа глобально уникален; после
  // voidTicket/voidOrder cards перезагружается, ссылка обновляется сама.
  const viewOrder = viewOrderId
    ? (cards?.flatMap((c) => c.ticketOrders).find((o) => o.id === viewOrderId) ?? null)
    : null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          {/* Реальный баг, найден пользователем 2026-07-24: вело на Главную
              вместо Денег — эта страница вложена в /money, как
              zone-balances/expenses/advances-bonuses, а не в корень. */}
          <BackLink label={t.money.title} href="/money" className="mb-2" />
          <h1 className="text-screen-title">{t.readings.title}</h1>

          {points.length === 0 ? (
            <p className="mt-4 text-body-airbnb text-muted-foreground">{t.readings.pointsEmptyHint}</p>
          ) : (
            <>
              {points.length > 1 ? (
                <div className="mt-4">
                  <Select
                    value={pointId ?? undefined}
                    onValueChange={(v) => {
                      if (!v) return;
                      setPointId(v);
                      setSelectedDate(null);
                      setCards(null);
                      setAbonementSales(null);
                    }}
                    items={points.map((p) => ({ value: p.id, label: p.name }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {/* Пока pointId не совпал ни с одной загруженной точкой
                            (короткое окно загрузки, или сохранённое "Все
                            точки" с Главной/Денег, где такой вариант есть, а
                            здесь — нет) триггер не должен быть пустым (реальный
                            баг, найден пользователем 2026-07-19: "Изначально
                            пусто") — показываем то же "Все точки", что и на
                            других экранах, до того как пункт ниже сам
                            подставит первую реальную точку. */}
                        <span className="flex items-center gap-2">
                          {(() => {
                            const current = points.find((p) => p.id === pointId);
                            return current?.iconKey ? (
                              <AssetOrZoneIcon iconKey={current.iconKey} className="size-6 shrink-0" />
                            ) : (
                              <MapPin className="size-6 shrink-0 text-muted-foreground" />
                            );
                          })()}
                          {points.find((p) => p.id === pointId)?.name ?? t.money.allPoints}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {points.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            {p.iconKey ? (
                              <AssetOrZoneIcon iconKey={p.iconKey} className="size-6 shrink-0" />
                            ) : (
                              <MapPin className="size-6 shrink-0 text-muted-foreground" />
                            )}
                            {p.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="mt-4 text-caption-airbnb">{points[0]?.name}</p>
              )}

              {/* Календарь центрируется и ограничен по ширине: ячейки
                  aspect-square, поэтому на широком экране карточка во всю
                  ширину раздувала их до огромных квадратов (2026-08-08). */}
              <SpringCard hover={false} className="mt-3.5">
                <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      aria-label={t.readings.prevMonth}
                      onClick={() => goMonth(-1)}
                      className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                    >
                      <ChevronLeft className="size-4.5" />
                    </button>
                    <p className="text-card-title">
                      {t.readings.months[month - 1]} {year}
                    </p>
                    <button
                      type="button"
                      aria-label={t.readings.nextMonth}
                      onClick={() => goMonth(1)}
                      disabled={isCurrentMonth}
                      className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronRight className="size-4.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center">
                    {t.readings.weekdays.map((w) => (
                      <span key={w} className="text-caption-airbnb font-semibold">
                        {w}
                      </span>
                    ))}
                    {cells.map((date, i) => {
                      if (!date) return <span key={`blank-${i}`} />;
                      const active = activeDates.has(date);
                      const day = Number(date.slice(-2));
                      return (
                        <button
                          key={date}
                          type="button"
                          disabled={!active}
                          onClick={() => openDay(date)}
                          className={cn(
                            "relative flex aspect-square items-center justify-center rounded-control text-base font-bold tabular-nums",
                            active ? "bg-primary text-primary-foreground" : "text-muted-foreground/70",
                            date === todayKey && !active && "text-foreground",
                            date === selectedDate && active && "ring-2 ring-primary ring-offset-2 ring-offset-card"
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </SpringCard>

              {/* Заголовок — внутри акцентной плашки "Итоги дня" вместе с
                  цифрами (запрос пользователя 2026-07-19: "сделай внутри
                  плашки акцентной схемы"), но по смыслу описывает ОБА блока
                  (Итоги дня + Абонементы + Товары ниже) — сами карточки/суммы
                  остаются раздельными. Отдельный fallback ниже — редкий
                  случай, когда за день были только продажи абонементов и/или
                  сверки Товаров без сдач зон (Товары независимы от режима
                  учёта зон — уточнение пользователя 2026-07-31): тогда
                  акцентной карточки нет, заголовок остаётся отдельным
                  блоком, как раньше. */}
              {selectedDate &&
                cards !== null &&
                cards.length === 0 &&
                ((abonementSales?.items.length ?? 0) > 0 ||
                  abonementSaleEvents.length > 0 ||
                  goodsReconciliations.length > 0 ||
                  goodsSales.length > 0) && (
                <div className="mt-3.5 flex items-center gap-2 px-1">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                    <FileText className="size-4.5" />
                  </div>
                  <div>
                    <p className="text-card-title">{t.readings.daySummaryTitle}</p>
                    <p className="text-caption-airbnb text-muted-foreground">{t.readings.daySummaryHint}</p>
                  </div>
                </div>
              )}

              {selectedDate && cards !== null && cards.length > 0 && (
                <SpringCard hover={false} className="mt-3.5 flex flex-col gap-1 border-primary/20 bg-primary/10">
                  <div className="flex items-center gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/20 text-primary">
                      <FileText className="size-4.5" />
                    </div>
                    <div>
                      <p className="text-card-title">{t.readings.daySummaryTitle}</p>
                      <p className="text-caption-airbnb text-muted-foreground">{t.readings.daySummaryHint}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 border-t border-primary/20 pt-2 tabular-nums">
                    <div className="flex items-center justify-between text-caption-airbnb">
                      <span className="flex items-center gap-1">
                        <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                        {t.operatorApp.submit.cashLabel}
                      </span>
                      <span className="text-foreground"><Money value={daySummary.cash} /></span>
                    </div>
                    <div className="flex items-center justify-between text-caption-airbnb">
                      <span className="flex items-center gap-1">
                        <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                        {t.operatorApp.submit.mobileLabel}
                      </span>
                      <span className="text-foreground"><Money value={daySummary.mobile} /></span>
                    </div>
                    {daySummary.abonement > 0 && (
                      <div className="flex items-center justify-between text-caption-airbnb">
                        <span className="flex items-center gap-1">
                          <PaymentMethodIcon method="abonement" className="size-3.5 shrink-0" />
                          {t.operatorApp.abonement.paymentLabel}
                        </span>
                        <span className="text-foreground"><Money value={daySummary.abonement} /></span>
                      </div>
                    )}
                    {/* Применимость — по режиму учёта, как у карточки
                        отдельной зоны ниже, а НЕ по тому, нулевое ли число —
                        0 возвратов за день тоже валидный результат и должен
                        быть виден (запрос пользователя 2026-07-19). */}
                    {cards.some(returnsApplicable) && (
                      <div className="flex items-center justify-between text-caption-airbnb">
                        <span className="flex items-center gap-1.5">
                          <RefreshCcw className="size-3.5 shrink-0" />
                          {t.operatorApp.submit.returnsLabelShort}
                        </span>
                        <span className="text-foreground">{daySummary.returnsCount}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-border pt-1.5 text-caption-airbnb">
                      {/* Оплаченное с баланса вычтено (решение владельца
                          2026-08-16: «расчётная выручка тоже не должна
                          учитывать оплату по балансу, нет смысла») — экран
                          показывает только то, что ждём ДЕНЬГАМИ, и тогда
                          «расчётная минус фактическая» прямо равна Разнице
                          ниже, без промежуточных строк. В самих счётчиках
                          валовая выручка не меняется — это только отображение
                          денежной части (docs/spec/01-counters.md). */}
                      <span>{t.operatorApp.submit.calculatedRevenue}</span>
                      <span>
                        <Money value={Math.round((daySummary.calculatedRevenue - daySummary.abonementInCash) * 100) / 100} />
                      </span>
                    </div>
                    {/* Фактическая — сумма Наличные+Безнал+Баланс, чтобы не
                        складывать их в уме при сравнении с Расчётной
                        выручкой (запрос пользователя 2026-07-18). Тот же
                        ключ, что уже использует Сотрудник на своём экране
                        подтверждения. Крупнее и жирным — это реальная касса
                        точки, важнее валовой Расчётной выручки выше (запрос
                        пользователя 2026-07-19). */}
                    {/* Оплата балансом в Фактическую кассу НЕ входит (решение
                        владельца 2026-08-16: "этих денег нет в помине... баланс
                        это уже не деньги, а виртуальная валюта"). Деньги за
                        абонемент тенант получил раньше, при пополнении, и там
                        они прошли наличными или безналом. В сверке баланс
                        по-прежнему участвует, но с другой стороны уравнения:
                        difference = касса − (расчётная − баланс), то есть он
                        уменьшает ОЖИДАЕМУЮ денежную выручку. Её и показываем
                        отдельной строкой, когда балансом платили: без неё
                        "касса минус расчётная" на экране не сходилось бы с
                        Разницей. Само значение — касса минус разница, это
                        тождество, лишних данных не требует. */}
                    <div className="flex items-center justify-between text-body-airbnb font-bold">
                      <span className="flex items-center gap-1.5 text-foreground">
                        {t.operatorApp.submit.actualCash}
                        <InfoTooltip text={t.readings.actualCashTooltip} />
                      </span>
                      <span className="text-foreground">
                        <Money value={daySummary.cash + daySummary.mobile} size="display" />
                      </span>
                    </div>
                    {/* Расходы дня — сразу под Фактической кассой (решение
                        владельца 2026-08-16): деньги вынули из неё же, и
                        читать это надо рядом, а не через Разницу. В саму
                        кассу и в Разницу они не входят — те отвечают за
                        сверку со счётчиками, а расход к моменту сдачи уже
                        вычтен сотрудником из введённого остатка. */}
                    {expenses.total > 0 && (
                      <div className="flex items-center justify-between text-caption-airbnb">
                        <span className="flex items-center gap-1.5">
                          <ShoppingCart className="size-3.5 shrink-0" />
                          {t.summaryText.expenses}
                        </span>
                        <span className="font-bold text-foreground">
                          −<Money value={expenses.total} />
                        </span>
                      </div>
                    )}
                    {/* Разница сверяется с ЧИСТОЙ выручкой (за вычетом
                        тестов/возвратов) — сама эта чистая выручка отдельной
                        строкой не показывается: она математически совпадает
                        с "Фактическая касса" ровно когда Разница=0 (обычный
                        случай) — вторая строка с тем же числом только
                        путала (реальная путаница пользователя, найдено
                        2026-07-19: "Фактическая выручка и Выручка после
                        возвратов это одно и то же"). */}
                    <div className="flex items-center justify-between text-caption-airbnb">
                      <span className="flex items-center gap-1.5">
                        {t.operatorApp.submit.difference}
                        {/* Предупреждающий треугольник остаётся отдельно и
                            рядом: это сигнал «не сошлось», а не справка, и
                            прятать его в тултип нельзя. */}
                        <InfoTooltip text={t.readings.differenceTooltip} />
                        {daySummary.difference !== 0 && <TriangleAlert className="size-3.5 shrink-0 text-warning" />}
                      </span>
                      <span
                        className={cn(
                          "font-bold",
                          daySummary.difference === 0
                            ? "text-muted-foreground"
                            : daySummary.difference > 0
                              ? "text-primary"
                              : "text-destructive"
                        )}
                      >
                        {daySummary.difference > 0 ? "+" : ""}
                        <Money value={daySummary.difference} />
                      </span>
                    </div>
                    {/* Что ушло из кассы за день и сколько наличных реально
                        осталось (решение владельца 2026-08-16: "фактическая
                        касса грязными... это портит картину Итогов дня").
                        Считаем от НАЛИЧНЫХ, а не от Фактической кассы: в ту
                        входят безнал и оплата балансом, которых в ящике нет.
                        Состав вычетов — тот же, что в сводке "Касса за день",
                        иначе два экрана про один день говорили бы разное.
                        Сами расходы стоят выше, под Фактической кассой, —
                        здесь они только участвуют в подсчёте остатка. */}
                    {(expenses.total > 0 || payouts > 0) && (
                      <>
                        {payouts > 0 && (
                          <div className="flex items-center justify-between border-t border-primary/20 pt-1.5 text-caption-airbnb">
                            <span className="flex items-center gap-1.5">
                              <Wallet className="size-3.5 shrink-0" />
                              {t.summaryText.bonusesAndAdvances}
                            </span>
                            <span className="font-bold text-foreground">
                              −<Money value={payouts} />
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between border-t border-border pt-1.5">
                          <span className="flex items-center gap-1.5 text-caption-airbnb">
                            {t.readings.cashLeftLabel}
                            <InfoTooltip text={t.readings.cashLeftTooltip} />
                          </span>
                          {/* size="display" — шрифт ужимается по длине числа
                              (запрос владельца 2026-08-16: "если будет
                              1 000 000, то не вместится"). Тот же механизм,
                              что у заголовочных сумм в Отчётах; фиксированный
                              размер оставлять нельзя — семизначная сумма
                              ломает строку. */}
                          <span className="text-[1.5625rem] font-bold leading-none text-foreground">
                            <Money
                              value={Math.round((daySummary.cash - expenses.total - payouts) * 100) / 100}
                              size="display"
                            />
                          </span>
                        </div>
                      </>
                    )}
                    {/* Отдельная строка — сколько всего денег физически на
                      точке за день, включая продажи абонементов (запрос
                      пользователя 2026-07-19: "пусть будет видно Фактическая
                      касса + абонементы"). Не заменяет и не трогает
                      Фактическую кассу/Разницу выше — те сверяют именно
                      сдачи зон с расчётной выручкой, у продажи абонемента
                      нет расчётной пары для сверки. Показываем только когда
                      абонементы вообще продавались в этот день. */}
                    {(abonementSales?.cash ?? 0) + (abonementSales?.mobile ?? 0) > 0 && (
                      <div className="flex items-center justify-between border-t border-primary/20 pt-1.5 text-caption-airbnb">
                        <span>{t.readings.pointCashWithAbonementLabel}</span>
                        {/* Сумма — вдвое крупнее подписи (0.78125rem × 2 =
                            1.5625rem), запрос пользователя 2026-07-19.
                            size="display" — та же защита от длинных чисел, что
                            у "Осталось наличными" выше (2026-08-16): эта сумма
                            заведомо больше, значит переполнится раньше. */}
                        <span className="text-[1.5625rem] font-bold leading-none text-foreground">
                          <Money
                            size="display"
                            value={
                              daySummary.cash +
                              daySummary.mobile +
                              daySummary.abonementInCash +
                              (abonementSales?.cash ?? 0) +
                              (abonementSales?.mobile ?? 0)
                            }
                          />
                        </span>
                      </div>
                    )}
                  </div>
                </SpringCard>
              )}

              {/* Продажи абонементов — отдельная карточка, не смешанная с
                  зонами (запрос пользователя 2026-07-18): эти деньги не
                  привязаны ни к одной зоне и не входят в Расчёт/Разницу
                  выше. Список планов по аналогии с активами ("Абонемент —
                  это Актив, Тариф — это стоимость абонемента"). */}
              {/* Условие включает и построчные продажи: разбивка по планам
                  строится ТОЛЬКО из операций с планом, а пополнение
                  произвольной суммой плана не имеет вовсе — без второго
                  слагаемого день с одними такими пополнениями не показывал бы
                  ни карточку, ни список, хотя продажи были. */}
              {selectedDate &&
                ((abonementSales !== null && abonementSales.items.length > 0) || abonementSaleEvents.length > 0) && (
                <SpringCard hover={false} className="mt-3.5 flex flex-col gap-1">
                  {/* Единый вид заголовков плашек дня — иконка без фоновой
                      подложки и шрифт мельче карточного (решение владельца
                      2026-08-16): Абонементы, Товары, Расходы выглядят
                      одинаково. */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-body-airbnb font-bold">
                      <Gift className="size-4 shrink-0 text-muted-foreground" />
                      {t.readings.abonementSalesTitle}
                    </p>
                    {/* Стрелка — в реестр продаж абонементов (модуль Клиенты,
                        таб "Продажи"), где владелец их и аннулирует. */}
                    <Link
                      href="/abonements?tab=sales"
                      aria-label={t.abonements.salesTab}
                      className="flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground"
                    >
                      <ChevronRight className="size-4.5" />
                    </Link>
                  </div>
                  <div className="mt-1 flex flex-col border-t border-border tabular-nums">
                    {(abonementSales?.items ?? []).map((item) => (
                      <div
                        key={item.abonementId}
                        className="flex items-center gap-2 border-b border-border py-2 last:border-b-0"
                      >
                        {/* Без иконки-кружка (решение владельца 2026-08-16):
                            плашка должна читаться так же, как Расходы. */}
                        <div className="min-w-0 flex-1 text-caption-airbnb">
                          <span className="font-semibold text-foreground">{item.name ?? t.abonements.title}</span>
                          {/* Метод оплаты — иконкой и подписью, количество
                              через × (правка владельца 2026-08-16): было
                              "1 безнал" текстом, что читалось хуже и не
                              совпадало с остальными строками проекта. */}
                          {item.cashCount > 0 && (
                            <span className="ml-1.5 inline-flex items-center gap-1 text-muted-foreground">
                              <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                              {t.operatorApp.submit.cashLabel} ×{item.cashCount}
                            </span>
                          )}
                          {item.mobileCount > 0 && (
                            <span className="ml-1.5 inline-flex items-center gap-1 text-muted-foreground">
                              <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                              {t.operatorApp.submit.mobileLabel} ×{item.mobileCount}
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 font-semibold text-foreground">
                          <Money value={item.cashAmount + item.mobileAmount} />
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Итог отдельной строкой — только когда тарифов
                      несколько: при одном тарифе он дублирует ту же сумму,
                      что уже видна в строке товара выше (запрос
                      пользователя 2026-07-19: "Наличные и безнал я добавил
                      бы в ту же строчку"). */}
                  {abonementSales !== null && abonementSales.items.length > 1 && (
                    <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-caption-airbnb font-semibold tabular-nums">
                      <span className="text-foreground">
                        {t.operatorApp.submit.cashLabel}: <Money value={abonementSales.cash} /> ·{" "}
                        {t.operatorApp.submit.mobileLabel}: <Money value={abonementSales.mobile} />
                      </span>
                    </div>
                  )}
                  {/* Списка продаж здесь больше нет (решение владельца
                      2026-08-16): в плашке — только итоги по планам, а сами
                      продажи с клиентами и аннулированием живут в модуле
                      Клиенты, таб "Продажи", куда ведёт стрелка в заголовке. */}
                </SpringCard>
              )}

              {/* Товары — отдельная карточка, тот же принцип, что и у
                  "Продажи абонементов" выше: деньги не привязаны ни к одной
                  зоне, не входят в Расчёт/Разницу зон. В отличие от
                  абонементов — по содержанию ближе к самой сдаче зоны
                  (Наличные/Безнал по факту, Расчётная касса, Разница), потому
                  что у Товаров, как и у зон, есть реальная сверка "что
                  ожидалось vs что по факту" (запрос пользователя 2026-07-31).
                  За день может быть НЕСКОЛЬКО сверок — показываем списком, не
                  сводкой (решение пользователя того же дня). НЕ зависит от
                  режима учёта зон точки (уточнение пользователя 2026-07-31) —
                  условие ниже сознательно не трогает cards/accountingMode. */}
              {/* Продажи учитываются в условии наравне со сверками: сверка —
                  отдельное событие и её за день может не быть вовсе, а
                  продажи при этом были. Без второго слагаемого карточка
                  пряталась целиком вместе с ними. */}
              {/* Расходы дня — своей карточкой, рядом с Абонементами и
                  Товарами (запрос владельца 2026-08-16). Живут отдельно от
                  сдач зон по той же причине, что и остальные два блока: это
                  не сверка кассы со счётчиками, а самостоятельные денежные
                  события дня. Показываются и в день без единой сдачи —
                  деньги ушли, и это факт дня. */}
              {selectedDate && expenses.items.length > 0 && (
                <SpringCard hover={false} className="mt-3.5 flex flex-col gap-1">
                  {/* Тот же заголовок, что у Абонементов и Товаров, плюс
                      стрелка в реестр расходов (запрос владельца
                      2026-08-16): из Итогов дня туда переходят чаще всего —
                      там правят, удаляют и видят комментарии. */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-body-airbnb font-bold">
                      <ShoppingCart className="size-4 shrink-0 text-muted-foreground" />
                      {t.summaryText.expenses}
                    </p>
                    <Link
                      href="/money/expenses"
                      aria-label={t.summaryText.expenses}
                      className="flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground"
                    >
                      <ChevronRight className="size-4.5" />
                    </Link>
                  </div>
                  {/* Только итог: список расходов с зонами, категориями и
                      комментариями живёт в реестре, куда ведёт стрелка выше
                      (решение владельца 2026-08-16 — три плашки дня
                      показывают итоги, подробности и правки на своих
                      страницах). Счёт записей — чтобы было видно, из
                      скольких трат сложилась сумма. */}
                  <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-caption-airbnb tabular-nums">
                    <span className="text-muted-foreground">
                      {t.goods.totalLabel} · {expenses.items.length}
                    </span>
                    <span className="font-bold text-foreground">
                      −<Money value={expenses.total} />
                    </span>
                  </div>
                </SpringCard>
              )}

              {selectedDate && (goodsReconciliations.length > 0 || goodsSales.length > 0) && (
                <SpringCard hover={false} className="mt-3.5 flex flex-col gap-1">
                  {/* Стрелка — сразу во вкладку "Продажи" Товаров (запрос
                      владельца 2026-08-16), не в Каталог: из Итогов дня
                      смотрят именно продажи. */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-body-airbnb font-bold">
                      <ShoppingBag className="size-4 shrink-0 text-muted-foreground" />
                      {t.readings.goodsReconciliationsTitle}
                    </p>
                    <Link
                      href="/goods?tab=purchases"
                      aria-label={t.goods.purchasesTitle}
                      className="flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground"
                    >
                      <ChevronRight className="size-4.5" />
                    </Link>
                  </div>
                  {/* День, где продажи были, а кассу Товаров ещё не сдавали:
                      без этой строки карточка осталась бы пустой — реестр из
                      неё убран (2026-08-16). Сумма и счёт, подробности — по
                      стрелке в разделе Товары. */}
                  {goodsReconciliations.length === 0 && goodsSales.length > 0 && (
                    <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-caption-airbnb tabular-nums">
                      <span className="text-muted-foreground">
                        {t.readings.salesSectionTitle} · {goodsSales.length}
                      </span>
                      <span className="font-semibold text-foreground">
                        <Money value={goodsSales.reduce((sum, g) => sum + g.amount, 0)} />
                      </span>
                    </div>
                  )}
                  <div
                    className={cn("mt-1 flex flex-col", goodsReconciliations.length > 0 && "border-t border-border")}
                  >
                    {goodsReconciliations.map((r) => (
                      <div key={r.id} className="flex flex-col gap-1 border-b border-border py-2 tabular-nums last:border-b-0">
                        {/* Сотрудник — единый чип проекта: имя на тусклом
                            фоне его цветовой метки (решение владельца
                            2026-08-16, "как в Задачах"). */}
                        <div className="flex min-w-0 items-center gap-1.5 text-caption-airbnb text-muted-foreground">
                          <span className="shrink-0">{formatTime(r.occurredAt)}</span>
                          <PerformedByTag
                            name={r.performedBy}
                            isOwner={r.performedByOwner}
                            avatarUrl={null}
                            iconKey={null}
                            colorTag={r.performedByColorTag}
                            showIcon
                          />
                        </div>
                        <div className="flex items-center justify-between text-caption-airbnb">
                          <span className="flex items-center gap-1">
                            <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                            {t.operatorApp.submit.cashLabel}
                          </span>
                          <span className="text-foreground"><Money value={r.actualCash} /></span>
                        </div>
                        <div className="flex items-center justify-between text-caption-airbnb">
                          <span className="flex items-center gap-1">
                            <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                            {t.operatorApp.submit.mobileLabel}
                          </span>
                          <span className="text-foreground"><Money value={r.actualMobile} /></span>
                        </div>
                        <div className="flex items-center justify-between border-t border-border pt-1 text-caption-airbnb">
                          <span>{t.operatorApp.submit.calculatedRevenue}</span>
                          <span><Money value={r.calculatedCash + r.calculatedMobile} /></span>
                        </div>
                        <div className="flex items-center justify-between text-caption-airbnb">
                          <span className="flex items-center gap-1.5">
                            {t.operatorApp.submit.difference}
                            {r.difference !== 0 && <TriangleAlert className="size-3.5 shrink-0 text-warning" />}
                          </span>
                          <span
                            className={cn(
                              "font-bold",
                              r.difference === 0
                                ? "text-muted-foreground"
                                : r.difference > 0
                                  ? "text-primary"
                                  : "text-destructive"
                            )}
                          >
                            {r.difference > 0 ? "+" : ""}
                            <Money value={r.difference} />
                          </span>
                        </div>
                        {/* Абонементная часть — деньги списаны с баланса
                            раньше, при пополнении, касса их уже не ждёт (тот
                            же принцип, что у abonementInDifference зон) —
                            только справочная строка, не участвует в Разнице
                            выше. */}
                        {r.calculatedAbonement > 0 && (
                          <div className="flex items-center justify-between text-caption-airbnb text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <PaymentMethodIcon method="abonement" className="size-3.5 shrink-0" />
                              {t.operatorApp.abonement.paymentLabel}
                            </span>
                            <span><Money value={r.calculatedAbonement} /></span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Реестра продаж здесь больше нет (решение владельца
                      2026-08-16): смотреть и править продажи — в разделе
                      Товары, вкладка "Продажи", куда ведёт стрелка в заголовке.
                      Список появился здесь 2026-08-04, когда полноценного
                      реестра ещё не было; теперь он только дублировал бы его
                      без возможности что-то исправить. В Итогах дня остаётся
                      сверка кассы Товаров — она про день, а не про товар. */}
                </SpringCard>
              )}

              {selectedDate && (
                <div className="mt-3.5 flex flex-col gap-3">
                  {cards === null ? null : cards.length === 0 ? (
                    (abonementSales?.items.length ?? 0) === 0 &&
                    goodsReconciliations.length === 0 && (
                      <p className="mt-1 text-body-airbnb text-muted-foreground">
                        {t.readings.noSubmissionsPrefix} {formatReadableDate(selectedDate)}
                      </p>
                    )
                  ) : (
                    cards.map((card) => (
                      <SpringCard key={card.zoneSubmissionId} hover={false} className="flex flex-col gap-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 grow">
                            {/* Дата — мелким, наравне со временем (правка
                                владельца 2026-08-16): крупным в карточке
                                должно читаться НАЗВАНИЕ ЗОНЫ ниже, а дата у
                                всех карточек дня и так одна — она выбрана в
                                календаре над списком. */}
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-caption-airbnb">{formatReadableDate(selectedDate)}</span>
                              <span className="text-caption-airbnb tabular-nums">{formatTime(card.submittedAt)}</span>
                              {/* Только иконка, без фона и подписи (запрос
                                  пользователя 2026-07-22: "везде по проекту
                                  достаточно только зелёной иконки... никаких
                                  фонов и надписей не надо") — тот же единый
                                  минимальный вид короны, что и везде. */}
                              {card.edited && <Crown className="size-3.5 shrink-0 text-success" />}
                            </div>
                            {/* Иконка вместо слова "Сотрудник:" (запрос
                                пользователя 2026-08-14). Именно простая
                                иконка Users и имя — без фото и без выбранной
                                сотрудником иконки (уточнение того же дня),
                                поэтому avatarUrl/iconKey передаём пустыми, а
                                не тянем с сервера. isOwner всегда false:
                                сдачу итогов проводит только Сотрудник. */}
                            <p className="flex flex-wrap items-center gap-x-1.5 text-caption-airbnb">
                              <PerformedByTag name={card.operatorName} isOwner={false} avatarUrl={null} iconKey={null} colorTag={card.operatorColorTag} showIcon />
                              {card.accountingMode === "counters" && card.editable && (
                                <span>· {t.readings.lastSubmissionNote}</span>
                              )}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {card.editable ? (
                              <>
                                <IconActionButton icon={Pencil} onClick={() => openEdit(card)} label={t.readings.editAction} />
                                <IconActionButton
                                  icon={Trash2}
                                  onClick={() => openDeleteConfirm(card)}
                                  label={t.readings.deleteAction}
                                  destructive
                                />
                              </>
                            ) : (
                              // Заблокированная сдача (не последняя в цепочке) — вместо
                              // действий поясняющая заметка (docs/spec/01-counters.md,
                              // "Прозрачность"), а не активные кнопки, ведущие к 409 уже
                              // после заполнения формы (аудит 2026-07-25, финальный проход).
                              <Lock className="size-4 shrink-0 text-muted-foreground" aria-label={lockedNoteFor(card, t)} />
                            )}
                          </div>
                        </div>

                        <div className="mt-3 border-t border-border pt-3">
                          {/* Название зоны — главное в карточке (правка
                              владельца 2026-08-16), поэтому размер тот, что
                              раньше занимала дата. */}
                          <p className="flex items-center gap-1.5 text-body-airbnb font-bold">
                            {card.zoneIconKey && (
                              <AssetOrZoneIcon iconKey={card.zoneIconKey} className="size-4.5 shrink-0 text-muted-foreground" />
                            )}
                            {card.zoneName}
                          </p>
                          {/* Активы — сворачиваемым списком, если их больше
                              трёх (решение пользователя 2026-08-04: "чтобы не
                              было очень громоздко"). У "Счётчиков" на каждый
                              актив идёт ещё подсписок тарифов, поэтому именно
                              этот блок и делал карточку высокой. */}
                          <CollapsibleRows
                            title={t.readings.assetsSectionTitle}
                            count={card.accountingMode === "cash_only" ? 0 : card.assets.length}
                          >
                          {card.accountingMode !== "cash_only" &&
                            card.assets.map((asset) => (
                              <div key={asset.assetId} className="mt-1.5 flex items-center gap-2">
                                <div className="relative shrink-0">
                                  <div className="flex size-16 items-center justify-center overflow-hidden rounded-control bg-muted">
                                    {asset.photoUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={asset.photoUrl} alt="" className="size-full object-contain object-center" />
                                    ) : asset.iconKey ? (
                                      <AssetOrZoneIcon iconKey={asset.iconKey} className="size-8 text-muted-foreground" />
                                    ) : null}
                                  </div>
                                  <span
                                    className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-card"
                                    style={{ backgroundColor: asset.colorTag }}
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="text-caption-airbnb font-semibold text-foreground">
                                    {asset.assetName}
                                  </span>
                                  {asset.readings.map((r) => (
                                    <div
                                      key={r.tariffId}
                                      className="flex items-center justify-between py-0.5 text-caption-airbnb"
                                    >
                                      <span>{r.tariffName}</span>
                                      <span className="flex items-center gap-1.5 tabular-nums">
                                        {r.editedBefore !== null && (
                                          <Info
                                            className="size-3.5 shrink-0 text-warning"
                                            aria-label={`${t.readings.editedByOwner} · ${t.readings.wasLabel}: ${r.editedBefore}`}
                                          />
                                        )}
                                        {r.previousValue !== null && (
                                          <span className="text-muted-foreground">
                                            {r.previousValue} → <b className="text-foreground">{r.value}</b>
                                          </span>
                                        )}
                                        <span className="min-w-10 text-right font-bold text-primary">
                                          +{r.sessions}
                                        </span>
                                    </span>
                                  </div>
                                ))}
                                </div>
                              </div>
                            ))}
                          </CollapsibleRows>
                          {/* "Прибывания"/тап-"Пуски" — из Launch, не из
                              assetReadings, поэтому card.assets тут всегда
                              пуст (реальный пробел, найден пользователем
                              2026-07-19 сразу следом за фиксом выручки для
                              этих же зон: "почему тут не делаешь разбивку по
                              активам?"). Count+amount вместо "было→стало" —
                              у пусков нет непрерывного счётчика.
                              Свёртка — та же и по тому же порогу, что у
                              "Счётчиков" выше: правило по длине списка, а не
                              по режиму учёта. */}
                          <CollapsibleRows
                            title={t.readings.assetsSectionTitle}
                            count={card.accountingMode === "cash_only" ? 0 : card.liveAssets.length}
                          >
                          {card.accountingMode !== "cash_only" &&
                            card.liveAssets.map((asset) => (
                              <div key={asset.assetId} className="mt-1.5 flex items-center gap-2">
                                <div className="relative shrink-0">
                                  <div className="flex size-16 items-center justify-center overflow-hidden rounded-control bg-muted">
                                    {asset.photoUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={asset.photoUrl} alt="" className="size-full object-contain object-center" />
                                    ) : asset.iconKey ? (
                                      <AssetOrZoneIcon iconKey={asset.iconKey} className="size-8 text-muted-foreground" />
                                    ) : null}
                                  </div>
                                  <span
                                    className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-card"
                                    style={{ backgroundColor: asset.colorTag }}
                                  />
                                </div>
                                <div className="flex min-w-0 flex-1 items-center justify-between">
                                  <span className="text-caption-airbnb font-semibold text-foreground">
                                    {asset.assetName}
                                  </span>
                                  <span className="flex items-center gap-1.5 text-caption-airbnb tabular-nums">
                                    <span className="text-muted-foreground">{asset.count}</span>
                                    <span className="font-bold text-primary">
                                      <Money value={asset.amount} />
                                    </span>
                                  </span>
                                </div>
                              </div>
                            ))}
                          </CollapsibleRows>
                          {/* Поштучный список пусков — для аннулирования
                              владельцем прямо в карточке, тот же
                              компактный-строки-паттерн, что у заказов билетов
                              ниже (аудит 2026-07-25: раньше у "Прибываний"/
                              тап-"Пусков" не было вообще никакого способа
                              исправить ошибочный/тестовый пуск).
                              Свёрнут по тому же порогу — за смену пусков
                              бывают десятки, и именно этот список делал
                              карточку бесконечной. Аннулирование остаётся на
                              месте, просто в один тап дальше. */}
                          {card.liveLaunches.length > 0 && (
                            <CollapsibleRows
                              title={
                                card.accountingMode === "stays"
                                  ? t.zonesList.modeChip.stays
                                  : t.zonesList.modeChip.launches
                              }
                              count={card.liveLaunches.length}
                            >
                            <div className="mt-2 flex flex-col gap-1.5">
                              {card.liveLaunches.map((l) => (
                                <div
                                  key={l.id}
                                  className="relative flex items-center gap-1.5 rounded-control bg-muted px-3 py-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-caption-airbnb font-semibold text-foreground">
                                      {l.assetName}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {formatTime(l.startedAt)}
                                      {l.endedAt ? ` – ${formatTime(l.endedAt)}` : ""}
                                    </p>
                                  </div>
                                  {l.paymentMethod && (
                                    <PaymentMethodIcon method={l.paymentMethod} className="size-3.5 shrink-0" />
                                  )}
                                  <Money value={l.amount} className="shrink-0 text-caption-airbnb font-bold" />
                                  <ConfirmIconButton
                                    label={t.operatorApp.gameRoom.voidLaunchAction}
                                    disabled={voidingLaunch === l.id}
                                    onConfirm={() => voidLaunch(l.id)}
                                    className="size-8"
                                  />
                                </div>
                              ))}
                            </div>
                            </CollapsibleRows>
                          )}
                          {card.liveLaunches.length > 0 && voidError && (
                            <p className="mt-2 text-sm text-destructive">{voidError}</p>
                          )}
                          {/* Билеты (docs/spec/10-tickets.md, "Отчёты", п.2) —
                              заказов N · билетов M, дальше разрez по активам
                              и вариантам (одна строка на комбинацию, заказ
                              мультиактивный — не переиспользует ни assets,
                              ни liveAssets выше).
                              Строка "заказов N · билетов M" остаётся на виду
                              всегда — это итог, а не элемент списка; сворачивается
                              только разрез по активам, по общему порогу. */}
                          {card.accountingMode === "tickets" && (
                            <div className="mt-1.5 flex flex-col gap-1.5">
                              <p className="text-caption-airbnb font-semibold text-foreground">
                                {t.tickets.ownerOrdersTitle}: {card.ticketsOrdersCount ?? 0} · {t.tickets.ticketsCountLabel}:{" "}
                                {card.ticketsCount ?? 0}
                              </p>
                              <CollapsibleRows
                                title={t.readings.assetsSectionTitle}
                                count={card.ticketAssets.length}
                              >
                              {card.ticketAssets.map((a) => (
                                <div
                                  key={`${a.assetId}:${a.variantName}`}
                                  className="flex items-center justify-between text-caption-airbnb"
                                >
                                  <span className="text-muted-foreground">
                                    {a.assetName} · {a.variantName}
                                  </span>
                                  <span className="flex items-center gap-1.5 tabular-nums">
                                    <span className="text-muted-foreground">{a.count}</span>
                                    <span className="font-bold text-primary">
                                      <Money value={a.amount} />
                                    </span>
                                  </span>
                                </div>
                              ))}
                              </CollapsibleRows>
                            </div>
                          )}
                          {/* Аннулирование заказов этого окна
                              (docs/spec/10-tickets.md, "Кабинет владельца",
                              п.3) — компактные строки, не полные карточки
                              (запрос пользователя 2026-07-22: "слишком
                              большой... компактно отображать список заказов и
                              заходить внутрь него" — раньше каждый заказ
                              разворачивал ВЕСЬ список билетов прямо тут).
                              Карандаш открывает BottomSheet с билетами и
                              поштучным аннулированием; мусорка в строке —
                              аннулирование заказа целиком, без захода внутрь.
                              Погашенные билеты не показываются вовсе, заказы,
                              где ПОГАШЕНЫ вообще все билеты, — тоже (те же
                              причины, что раньше).
                              Свёрнут по тому же порогу, что и остальные
                              списки: правка и аннулирование остаются, просто
                              в один тап дальше. */}
                          {card.accountingMode === "tickets" &&
                            card.ticketOrders.some((o) => o.tickets.some((tk) => tk.status !== "redeemed")) && (
                              <CollapsibleRows
                                title={t.tickets.ownerOrdersTitle}
                                count={
                                  card.ticketOrders.filter((o) =>
                                    o.tickets.some((tk) => tk.status !== "redeemed")
                                  ).length
                                }
                              >
                              <div className="mt-2 flex flex-col gap-1.5">
                                {card.ticketOrders
                                  .filter((o) => o.tickets.some((tk) => tk.status !== "redeemed"))
                                  .map((o) => {
                                    const hasVoidableTicket = o.tickets.some((tk) => tk.status === "active");
                                    return (
                                      <div
                                        key={o.id}
                                        className="relative flex items-center gap-1.5 rounded-control bg-muted px-3 py-2"
                                      >
                                        <div className="min-w-0 flex-1">
                                          <p className="text-caption-airbnb font-bold tabular-nums">
                                            {t.tickets.orderNumberLabel}
                                            <span className="text-primary">{o.number}</span>
                                          </p>
                                          {/* Продавец — тем же чипом, что и в
                                              продажах товаров/абонементов:
                                              одно и то же понятие не должно
                                              выглядеть по-разному от карточки
                                              к карточке. */}
                                          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                            {formatTime(o.soldAt)}
                                            <PerformedByTag
                                              name={o.soldByOperatorName}
                                              isOwner={false}
                                              avatarUrl={null}
                                              iconKey={null}
                                              colorTag={o.soldByOperatorColorTag}
                                              showIcon
                                            />
                                          </p>
                                        </div>
                                        <Money value={o.totalSnapshot} className="shrink-0 text-caption-airbnb font-bold" />
                                        <IconActionButton
                                          icon={Pencil}
                                          label={t.common.edit}
                                          onClick={() => setViewOrderId(o.id)}
                                        />
                                        {hasVoidableTicket && (
                                          <ConfirmIconButton
                                            label={t.tickets.voidOrderAction}
                                            disabled={voidingOrder === o.id}
                                            onConfirm={() => voidOrder(o.id)}
                                            className="size-8"
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                              </CollapsibleRows>
                            )}
                          {card.accountingMode === "tickets" && voidError && (
                            <p className="mt-2 text-sm text-destructive">{voidError}</p>
                          )}
                        </div>

                        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 tabular-nums">
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span className="flex items-center gap-1.5">
                              <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                              {t.operatorApp.submit.cashLabel}
                              {card.cashEditedBefore !== null && (
                                <Info
                                  className="size-3.5 shrink-0 text-warning"
                                  aria-label={`${t.readings.editedByOwner} · ${t.readings.wasLabel}: ${formatMoney(card.cashEditedBefore, locale)}`}
                                />
                              )}
                            </span>
                            <span className="text-foreground"><Money value={card.cashAmount} /></span>
                          </div>
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span className="flex items-center gap-1.5">
                              <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                              {t.operatorApp.submit.mobileLabel}
                            </span>
                            <span className="text-foreground"><Money value={card.mobileAmount} /></span>
                          </div>
                          {/* Справочно, не входит в Наличные/Безнал/Разницу выше —
                              касса уже получила эту сумму раньше, при пополнении
                              абонемента (запрос пользователя 2026-07-17: "во всех
                              отчётах... правильные цифры", "добавить Абонемент").
                              Условно, как и у "Прибываний"/"Пусков" в мастере
                              сдачи — не захламляет карточки зон, где абонементом
                              не пользовались. */}
                          {card.abonementAmount > 0 && (
                            <div className="flex items-center justify-between text-caption-airbnb">
                              <span className="flex items-center gap-1.5">
                                <PaymentMethodIcon method="abonement" className="size-3.5 shrink-0" />
                                {t.operatorApp.abonement.paymentLabel}
                              </span>
                              <span className="text-foreground"><Money value={card.abonementAmount} /></span>
                            </div>
                          )}
                          {returnsApplicable(card) && (
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span className="flex items-center gap-1.5">
                              <RefreshCcw className="size-3.5 shrink-0" />
                              {t.operatorApp.submit.returnsLabel}
                            </span>
                            <span className="text-foreground">{card.returnsCount}</span>
                          </div>
                          )}
                          {/* История тестовых прогонов (запрос пользователя
                              2026-08-04). Число выше остаётся — оно то, что
                              реально сохранено в сдаче; список показывает, из
                              чего оно сложилось. Расхождение возможно, если
                              владелец правил число вручную через шторку
                              редактирования: тогда счётчик — правда сдачи, а
                              список — правда журнала событий, и подменять
                              одно другим было бы враньём в обе стороны. */}
                          {returnsApplicable(card) && (
                            <CollapsibleRows
                              title={t.readings.testRunsSectionTitle}
                              count={(card.returnEvents ?? []).length}
                              icon={<RefreshCcw className="size-3.5 shrink-0" />}
                            >
                              {(card.returnEvents ?? []).map((e, i) => (
                                <div
                                  key={`${e.occurredAt}-${i}`}
                                  className="flex items-center justify-between gap-2 border-t border-border py-1.5 text-caption-airbnb"
                                >
                                  <span className="tabular-nums text-muted-foreground">{formatTime(e.occurredAt)}</span>
                                  <PerformedByTag
                                    name={e.performedBy}
                                    isOwner={e.performedByOwner}
                                    avatarUrl={null}
                                    iconKey={null}
                                    colorTag={e.performedByColorTag}
                                    showIcon
                                  />
                                </div>
                              ))}
                            </CollapsibleRows>
                          )}
                          {/* "Погашено X из Y · истекло Z" — только при
                              включённом гашении зоны (docs/spec/10-tickets.md,
                              "Отчёты", п.3: "при выключенном гашении —
                              погашенных не существует"). */}
                          {card.accountingMode === "tickets" && card.ticketRedemptionEnabled && (
                            <div className="flex items-center justify-between text-caption-airbnb">
                              <span>
                                {t.tickets.redeemedStatusLabel}: {card.ticketsRedeemedCount ?? 0} {t.common.of}{" "}
                                {card.ticketsCount ?? 0}
                              </span>
                              <span className="text-foreground">
                                {t.tickets.expiredStatusLabel.toLowerCase()}: {card.ticketsExpiredCount ?? 0}
                              </span>
                            </div>
                          )}
                          {/* Кто гасил — то же, чем для "Счётчиков" стал
                              список тестовых прогонов: число выше объясняется
                              построчно. Для "Билетов" это и есть "кто кого
                              обслужил": продажа и использование разнесены по
                              времени и по сотрудникам, продавца заказа тут
                              переиспользовать нельзя.
                              Окно то же, что у числа "Погашено X из Y" —
                              билеты заказов ЭТОГО окна, независимо от того,
                              когда их погасили; иначе список не сходился бы с
                              числом над ним. */}
                          {card.accountingMode === "tickets" && card.ticketRedemptionEnabled && (
                            <CollapsibleRows
                              title={t.tickets.redeemedStatusLabel}
                              count={redeemedTicketsOf(card).length}
                              icon={<TicketCheck className="size-3.5 shrink-0" />}
                            >
                              {redeemedTicketsOf(card).map((tk) => (
                                <div
                                  key={tk.id}
                                  className="flex items-center justify-between gap-2 border-t border-border py-1.5 text-caption-airbnb"
                                >
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="tabular-nums text-muted-foreground">
                                      {tk.redeemedAt ? formatTime(tk.redeemedAt) : "—"}
                                    </span>
                                    <span className="truncate text-foreground">
                                      {tk.assetName} · {tk.variantNameSnapshot}
                                    </span>
                                  </span>
                                  <PerformedByTag
                                    name={tk.redeemedByOperatorName}
                                    isOwner={false}
                                    avatarUrl={null}
                                    iconKey={null}
                                    colorTag={tk.redeemedByOperatorColorTag}
                                    showIcon
                                  />
                                </div>
                              ))}
                            </CollapsibleRows>
                          )}
                          {card.accountingMode !== "cash_only" && (
                          <>
                          <div className="flex items-center justify-between border-t border-border pt-1.5 text-caption-airbnb">
                            {/* Без оплаченного с баланса — как в сводной
                                карточке дня выше (2026-08-16). */}
                            <span>{t.operatorApp.submit.calculatedRevenue}</span>
                            <span>
                              <Money value={Math.round((card.calculatedRevenue - card.abonementInDifference) * 100) / 100} />
                            </span>
                          </div>
                          {/* Фактическая — сумма Наличные+Безнал+Баланс, чтобы
                              не складывать их в уме (запрос пользователя
                              2026-07-18). Крупнее и жирным — важнее валовой
                              Расчётной выручки выше (запрос пользователя
                              2026-07-19, тот же приём, что и в сводной
                              карточке "Итоги дня"). "Выручка после
                              возвратов" рядом больше не показываем — она
                              математически совпадает с этой суммой ровно
                              когда Разница=0, вторая строка с тем же числом
                              только путала. */}
                          <div className="flex items-center justify-between text-body-airbnb font-bold">
                            <span className="text-foreground">{t.operatorApp.submit.actualCash}</span>
                            <span className="text-foreground">
                              {/* Только настоящие деньги — наличные и безнал
                                  (решение владельца 2026-08-16, см. тот же
                                  разбор у сводной карточки "Итоги дня" выше).
                                  Оплаченное балансом стоит отдельной строкой
                                  и в кассу не прибавляется: в сверке оно
                                  вычитается из ожидаемой выручки. */}
                              <Money value={card.cashAmount + card.mobileAmount} />
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-caption-airbnb">
                            <span className="flex items-center gap-1.5">
                              {t.operatorApp.submit.difference}
                              {card.difference !== 0 && <TriangleAlert className="size-3.5 shrink-0 text-warning" />}
                            </span>
                            <span
                              className={cn(
                                "font-bold",
                                card.difference === 0
                                  ? "text-muted-foreground"
                                  : card.difference > 0
                                    ? "text-primary"
                                    : "text-destructive"
                              )}
                            >
                              {card.difference > 0 ? "+" : ""}
                              <Money value={card.difference} />
                            </span>
                          </div>
                          </>
                          )}
                        </div>

                        {!card.editable && (
                          <p className="mt-3 rounded-control bg-surface-0 p-3 text-xs leading-relaxed text-muted-foreground">
                            {lockedNoteFor(card, t)}
                          </p>
                        )}
                      </SpringCard>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <BottomSheet open={actionsFor !== null && actionsView === "edit"} onClose={() => setActionsFor(null)}>
        {actionsFor && (
          <div className="flex flex-col gap-3 pt-2">
            <div>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.readings.editSheetTitle}</h2>
              <p className="text-caption-airbnb">
                {actionsFor.editable ? t.readings.autoRecalcHint : t.readings.lockedNote}
              </p>
            </div>

            {actionsFor.assets.map((asset) => (
              <div key={asset.assetId} className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div className="flex size-16 items-center justify-center overflow-hidden rounded-control bg-muted">
                    {asset.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.photoUrl} alt="" className="size-full object-contain object-center" />
                    ) : asset.iconKey ? (
                      <AssetOrZoneIcon iconKey={asset.iconKey} className="size-8 text-muted-foreground" />
                    ) : null}
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-card"
                    style={{ backgroundColor: asset.colorTag }}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-card-title leading-tight">{asset.assetName}</p>
                  {asset.readings.map((r) => {
                    const key = `${asset.assetId}:${r.tariffId}`;
                    return (
                      <div key={r.tariffId} className="flex items-center justify-between gap-2">
                        <Label htmlFor={key} className="gap-1.5">
                          <span>{r.tariffName}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {t.operatorApp.submit.previousReading}{" "}
                            <span className="font-bold text-foreground">{r.previousValue}</span>
                          </span>
                        </Label>
                        <Input
                          id={key}
                          inputMode="numeric"
                          className="h-7 w-20 shrink-0 text-right tabular-nums"
                          value={editReadings[key] ?? ""}
                          onChange={(e) => setEditReadings((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-2">
              <p className="text-section-title">{t.readings.moneySection}</p>
              <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="editCash">{t.operatorApp.submit.cashLabel}</Label>
                    <MoneyInput
                      id="editCash"
                      value={editCash}
                      onChange={(e) => setEditCash(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="editMobile">{t.operatorApp.submit.mobileLabel}</Label>
                    <MoneyInput
                      id="editMobile"
                      value={editMobile}
                      onChange={(e) => setEditMobile(e.target.value)}
                    />
                  </div>
                </div>
                {/* "Возвраты/тестовые" — понятие только "Счётчиков" (и legacy
                    "Пусков" на показаниях, card.assets.length > 0 — сейчас
                    такие уже не создаются, но старые сдачи могли остаться).
                    У Билетов эту роль играет аннулирование
                    (docs/spec/10-tickets.md, "Отчёты", п.3), у Прибываний и
                    тап-"Пусков" возвратов как понятия нет вовсе — то же
                    isLiveZone, что уже использует computeEditPreview ниже.
                    Раньше условие исключало только cash_only/tickets,
                    оставляя мёртвый — без всякого эффекта на Расчёт/Разницу —
                    степпер у Прибываний и тап-"Пусков" (реальный баг, найден
                    при аудите 2026-07-22: то же исключение, что уже сделали
                    для сводок Telegram/Email, было пропущено именно здесь). */}
                {actionsFor.accountingMode !== "cash_only" &&
                  actionsFor.accountingMode !== "tickets" &&
                  !(actionsFor.accountingMode === "stays" || (actionsFor.accountingMode === "launches" && actionsFor.assets.length === 0)) && (
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="flex items-center gap-1.5 text-body-airbnb font-semibold">
                      <RefreshCcw className="size-4 shrink-0" />
                      {t.operatorApp.submit.returnsLabel}
                    </p>
                    <div className="flex items-center overflow-hidden rounded-control border border-border">
                      <button
                        type="button"
                        className="flex size-10 items-center justify-center bg-muted"
                        onClick={() => setEditReturns(String(Math.max(0, Number(editReturns || 0) - 1)))}
                      >
                        <Minus className="size-4" />
                      </button>
                      <span className="w-11 text-center text-[0.9375rem] font-bold tabular-nums">
                        {editReturns || 0}
                      </span>
                      <button
                        type="button"
                        className="flex size-10 items-center justify-center bg-muted"
                        onClick={() => setEditReturns(String(Number(editReturns || 0) + 1))}
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {actionsFor.accountingMode !== "cash_only" &&
                (() => {
                  const preview = computeEditPreview(actionsFor);
                  return (
                    <p className="text-caption-airbnb tabular-nums">
                      {t.operatorApp.submit.calculatedRevenue} <Money value={preview.calculatedRevenue} /> ·{" "}
                      {t.operatorApp.submit.difference} {preview.difference > 0 ? "+" : ""}
                      <Money value={preview.difference} />
                    </p>
                  );
                })()}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="editReason">
                {t.readings.reasonLabel}{" "}
                <span className="font-normal text-muted-foreground">· {t.readings.reasonOptionalHint}</span>
              </Label>
              <Input
                id="editReason"
                placeholder={t.readings.reasonPlaceholder}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
              />
            </div>

            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <PressableScale>
              <SaveButton className="w-full" onClick={confirmEdit} saved={editSaved} />
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={actionsFor !== null && actionsView === "confirm-delete"} onClose={() => setActionsFor(null)}>
        {actionsFor && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.readings.deleteConfirmTitle}</h2>
            <p className="text-body-airbnb">
              {actionsFor.editable ? t.readings.deleteConfirmBody : t.readings.lockedNote}
            </p>
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <PressableScale>
              <DeleteButton className="h-12 w-full" disabled={deleting} onClick={confirmDelete} deleted={readingDeleted}>
                {t.readings.deleteAction}
              </DeleteButton>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      {/* Детали заказа билетов — открывается карандашом из компактной строки
          заказа выше (запрос пользователя 2026-07-22: "заходить внутрь него и
          там уже удалять билеты"). Только просмотр+поштучное аннулирование
          (docs/spec/10-tickets.md, "Кабинет владельца", п.3), никакого
          гашения — это действие оператора. Погашенные билеты не рендерятся
          вовсе (запрос пользователя 2026-07-21) — над ними нет доступного
          действия. Аннулирование заказа целиком — НЕ здесь, кнопка вынесена в
          саму строку заказа (мусорка рядом с карандашом), чтобы не заставлять
          заходить внутрь ради этого одного действия. */}
      <BottomSheet open={viewOrderId !== null} onClose={() => setViewOrderId(null)}>
        {viewOrder && (
          <div className="flex flex-col gap-3 pt-2">
            <div>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em] tabular-nums">
                {t.tickets.orderNumberLabel}
                <span className="text-primary">{viewOrder.number}</span>
              </h2>
              <p className="flex flex-wrap items-center gap-1.5 text-caption-airbnb text-muted-foreground">
                {new Date(viewOrder.soldAt).toLocaleString(locale)} · {t.tickets.soldByLabel}
                <PerformedByTag
                  name={viewOrder.soldByOperatorName}
                  isOwner={false}
                  avatarUrl={null}
                  iconKey={null}
                  colorTag={viewOrder.soldByOperatorColorTag}
                  showIcon
                />
              </p>
            </div>
            <TicketOrderVoidList
              order={viewOrder}
              t={t}
              voidingTicket={voidingTicket}
              onVoidTicket={(ticketId) => voidTicket(viewOrder.id, ticketId)}
            />
            {voidError && <p className="text-sm text-destructive">{voidError}</p>}
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}

// Список билетов заказа с поштучным аннулированием — тело BottomSheet'а
// выше. Статус "Активен" НЕ выводится (запрос пользователя 2026-07-22: "на
// мой взгляд вообще не актуальна") — это подразумеваемое умолчание, подпись
// нужна только для исключений (аннулирован/истёк).
function TicketOrderVoidList({
  order,
  t,
  voidingTicket,
  onVoidTicket,
}: {
  order: DayCard["ticketOrders"][number];
  t: ReturnType<typeof useI18n>;
  voidingTicket: string | null;
  onVoidTicket: (ticketId: string) => void;
}) {
  const now = new Date();
  const visibleTickets = order.tickets.filter((tk) => tk.status !== "redeemed");

  function statusOf(tk: (typeof visibleTickets)[number]): { text: string; cls: string } | null {
    if (tk.status === "voided") return { text: t.tickets.voidedStatusLabel, cls: "text-destructive" };
    if (order.expiresAt != null && new Date(order.expiresAt) < now) {
      return { text: t.tickets.expiredStatusLabel, cls: "text-destructive" };
    }
    return null;
  }

  return (
    <div className="flex flex-col">
      {visibleTickets.map((tk) => {
        const status = statusOf(tk);
        return (
          <div
            key={tk.id}
            // min-h, а не только py — "Точно?" убирает мусорку из потока
            // (ConfirmIconButton в подтверждении — absolute inset-0), без
            // фиксированной высоты строка со всеми соседями прыгала вверх
            // при подтверждении и обратно вниз при отмене (запрос
            // пользователя 2026-07-22: "видно, как скачут строки"). Высота
            // подобрана под сам оверлей "Точно?" (две круглые size-8-кнопки
            // + текст) — тот же ориентир, что просил пользователь.
            className="relative flex min-h-12 items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
          >
            <div className="min-w-0">
              <p className="truncate text-caption-airbnb font-semibold">
                {tk.assetName} · {tk.variantNameSnapshot}
              </p>
              {status && <p className={cn("text-xs font-semibold", status.cls)}>{status.text}</p>}
            </div>
            {tk.status === "active" ? (
              <ConfirmIconButton
                label={t.tickets.voidTicketAction}
                disabled={voidingTicket === tk.id}
                onConfirm={() => onVoidTicket(tk.id)}
              />
            ) : (
              <Money value={tk.priceSnapshot} className="shrink-0 text-caption-airbnb font-semibold text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );
}
