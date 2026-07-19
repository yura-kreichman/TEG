"use client";

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ShoppingBag,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Wallet2,
  Settings2,
  X,
  ClipboardList,
  Banknote,
  CreditCard,
  Crown,
  Check,
} from "lucide-react";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconActionButton } from "@/components/kebab-menu";
import { FilePickerButton } from "@/components/file-picker-button";
import { Money } from "@/components/money";
import { useI18n, useLocale } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { usePersistedPointId } from "@/hooks/use-persisted-point-id";
import { compressImageFile } from "@/lib/client-image";
import { formatMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CategoryInfo {
  id: string;
  name: string;
  order: number;
}

interface GoodsInfo {
  id: string;
  categoryId: string;
  name: string;
  photoUrl: string | null;
  price: number;
  lowStockThreshold: number | null;
  trackStock: boolean;
  quantity: number | null;
}

interface PointInfo {
  id: string;
  name: string;
  iconKey: string | null;
}

interface StockGoods {
  id: string;
  categoryId: string;
  name: string;
  photoUrl: string | null;
  lowStockThreshold: number | null;
  quantity: number;
}

interface RevisionEntry {
  id: string;
  pointName: string;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByAvatarUrl: string | null;
  performedByIconKey: string | null;
  occurredAt: string;
  groups: {
    categoryName: string;
    lines: { goodsName: string; calculatedQuantity: number; actualQuantity: number; difference: number }[];
  }[];
}

interface OperatorInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
  iconKey: string | null;
}

interface SaleEntry {
  id: string;
  goodsName: string;
  categoryId: string;
  pointName: string;
  pointIconKey: string | null;
  quantity: number;
  amount: number;
  paymentMethod: string;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByAvatarUrl: string | null;
  performedByIconKey: string | null;
  occurredAt: string;
  voidedAt: string | null;
}

interface SalesSummary {
  count: number;
  revenue: number;
  cash: number;
  mobile: number;
  abonement: number;
}

interface ReconciliationEntry {
  id: string;
  pointName: string;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByAvatarUrl: string | null;
  performedByIconKey: string | null;
  actualCash: number;
  actualMobile: number;
  occurredAt: string;
}

// Мини-аватар сотрудника в списках продаж/ревизий/сверок (запрос
// пользователя 2026-07-19: "фото/иконку сотрудников") — тот же приём
// приоритета, что у крупной карточки оператора в /reports/[pointId]
// (фото → выбранная иконка → первая буква имени), просто в компактном
// размере под однострочные записи. isOwner (действие выполнено Владельцем,
// не Сотрудником) — реальный баг был показан email вместо имени (запрос
// пользователя 2026-07-19: "должно быть написано 'Владелец'"), теперь
// отдельная иконка + t.common.ownerLabel, без обращения к email.
function PerformedByTag({
  name,
  isOwner,
  avatarUrl,
  iconKey,
  t,
}: {
  name: string | null;
  isOwner: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  t: ReturnType<typeof useI18n>;
}) {
  if (isOwner) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Crown className="size-3 text-primary" />
        </span>
        {t.common.ownerLabel}
      </span>
    );
  }
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="size-4 shrink-0 rounded-full object-cover" />
      ) : iconKey ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <AssetOrZoneIcon iconKey={iconKey} className="size-3" />
        </span>
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[0.5625rem] font-bold text-primary-foreground">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {name}
    </span>
  );
}

// Иконка способа оплаты (запрос пользователя 2026-07-19: "иконки способов
// оплаты") — те же иконки, что уже используются для cash/mobile на экране
// оплаты оператора (operator-app submit) и абонемента (Banknote/CreditCard),
// Wallet2 — для баланса абонемента, тот же, что кнопка "Сверить кассу" выше.
function PaymentMethodIcon({ method, className }: { method: string; className?: string }) {
  const Icon = method === "cash" ? Banknote : method === "mobile" ? CreditCard : Wallet2;
  return <Icon className={className ?? "size-3.5 shrink-0"} />;
}

type PeriodGranularity = "day" | "week" | "month" | "year";

function toDateStr(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Общая логика День/Неделя/Месяц/Год для обеих вкладок с периодом ("Продажи"
// и "Кассы", запрос пользователя 2026-07-19) — чистые функции без состояния,
// чтобы не дублировать её дважды под разными именами переменных.
function isPeriodCurrent(granularity: PeriodGranularity, anchor: Date): boolean {
  const today = new Date();
  if (granularity === "year") return anchor.getUTCFullYear() === today.getUTCFullYear();
  if (granularity === "month") {
    return anchor.getUTCFullYear() === today.getUTCFullYear() && anchor.getUTCMonth() === today.getUTCMonth();
  }
  if (granularity === "day") return toDateStr(anchor) === toDateStr(today);
  const weekStart = (d: Date) => {
    const day = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  };
  return weekStart(anchor) === weekStart(today);
}

function stepPeriodAnchor(granularity: PeriodGranularity, anchor: Date, delta: number): Date {
  const next = new Date(anchor);
  if (granularity === "day") next.setUTCDate(next.getUTCDate() + delta);
  else if (granularity === "week") next.setUTCDate(next.getUTCDate() + delta * 7);
  else if (granularity === "month") next.setUTCMonth(next.getUTCMonth() + delta);
  else next.setUTCFullYear(next.getUTCFullYear() + delta);
  return next;
}

function formatPeriodLabel(granularity: PeriodGranularity, anchor: Date, t: ReturnType<typeof useI18n>): string {
  if (granularity === "year") return String(anchor.getUTCFullYear());
  if (granularity === "month") return `${t.readings.months[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
  if (granularity === "day") {
    return `${anchor.getUTCDate()} ${t.readings.monthsGenitive[anchor.getUTCMonth()]} (${t.readings.weekdaysFull[(anchor.getUTCDay() + 6) % 7]})`;
  }
  const day = (anchor.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - day));
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return sameMonth
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]}`
    : `${start.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]} – ${end.getUTCDate()} ${t.readings.monthsGenitive[end.getUTCMonth()]}`;
}

// Минимальная ширина колонки графика (px) — тот же приём, что "Отчёты →
// Динамика" (см. reports/[pointId]/page.tsx): при "Неделя"/"Год" (мало
// столбцов) не задействуется, при "Месяц"/"Период" с большим числом дней
// контейнер скроллится по горизонтали вместо сжатия столбцов.
const GOODS_CHART_COLUMN_MIN_WIDTH = 36;

// График — тот же паттерн, что "Отчёты → Динамика" (запрос пользователя
// 2026-07-19), но однослойный (только сумма за день/месяц, без "Прибыли" —
// у Товаров нет привязанных к ним расходов). Переиспользуется и для "Кассы"
// (сумма сданных Наличные+Безнал), и потенциально для "Продаж".
function GoodsBarsChart({
  bars,
  granularity,
  t,
}: {
  bars: { date: string; total: number; hasData: boolean }[];
  granularity: PeriodGranularity;
  t: ReturnType<typeof useI18n>;
}) {
  const locale = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    updateScrollState();
  }, [bars]);

  function scrollChart(direction: 1 | -1) {
    scrollRef.current?.scrollBy({ left: direction * 150, behavior: "smooth" });
  }

  const visibleBars = bars.filter((b) => b.hasData);
  if (visibleBars.length === 0) {
    return <p className="text-body-airbnb text-muted-foreground">{t.reports.noDataForPeriod}</p>;
  }

  const maxVal = Math.max(1, ...visibleBars.map((b) => b.total));
  const yFor = (v: number) => 100 - (v / maxVal) * 100;
  const xFor = (i: number) => ((i + 0.5) / visibleBars.length) * 100;
  const points = visibleBars.map((b, i) => `${xFor(i)},${yFor(b.total)}`).join(" ");

  return (
    <SpringCard animate={false} hover={false} className="relative">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollChart(-1)}
          aria-label={t.reports.chartScrollLeft}
          className="absolute -left-2 top-1/2 z-30 flex size-8 -translate-y-1/2 items-center justify-center rounded-control bg-card text-muted-foreground"
        >
          <ChevronLeft className="size-4.5" />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollChart(1)}
          aria-label={t.reports.chartScrollRight}
          className="absolute -right-2 top-1/2 z-30 flex size-8 -translate-y-1/2 items-center justify-center rounded-control bg-card text-muted-foreground"
        >
          <ChevronRight className="size-4.5" />
        </button>
      )}
      <div ref={scrollRef} onScroll={updateScrollState} className="overflow-x-auto scrollbar-none">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${visibleBars.length}, minmax(${GOODS_CHART_COLUMN_MIN_WIDTH}px, 1fr))` }}
        >
          {visibleBars.map((b) => (
            <div key={`v-${b.date}`} className="overflow-hidden text-center text-[0.5rem] font-bold tabular-nums text-primary">
              {b.total > 0 && (
                <div className="truncate">
                  {formatMoneyCompact(b.total, locale, t.reports.compactThousandSuffix, t.reports.compactMillionSuffix)}
                </div>
              )}
            </div>
          ))}
          <div className="relative col-span-full" style={{ height: 70 }}>
            {visibleBars.length > 1 && (
              <svg
                className="pointer-events-none absolute inset-0 size-full overflow-visible"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polyline
                  points={points}
                  fill="none"
                  className="text-primary"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
            {visibleBars.map((b, i) => (
              <div key={`m-${b.date}`} className="pointer-events-none absolute inset-0 size-full">
                <div
                  className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
                  style={{ left: `${xFor(i)}%`, top: `${yFor(b.total)}%` }}
                />
              </div>
            ))}
          </div>
          {visibleBars.map((b) => (
            <div key={`w-${b.date}`} className="overflow-hidden truncate text-center text-[0.625rem] font-semibold text-muted-foreground">
              {new Date(b.date).toLocaleDateString(undefined, granularity === "year" ? { month: "short" } : { weekday: "short" })}
            </div>
          ))}
        </div>
      </div>
    </SpringCard>
  );
}

const EMPTY_GOODS_FORM = {
  categoryId: "",
  name: "",
  photoUrl: null as string | null,
  price: "",
  lowStockThreshold: "",
  trackStock: true,
};

/**
 * Кабинет владельца, модуль "Товары" (docs/spec/09-goods.md, "Кабинет
 * владельца") — три вкладки: Каталог/Остатки/Продажи (та же схема, что у
 * Абонементов — SegmentedTabs вместо одной длинной страницы). Эта версия —
 * Каталог + Остатки; Продажи (сводка/сверка/список/аннулирование) — следующим
 * шагом, тот же паттерн, что двухчастная сборка ШАГ 3/4.
 */
export default function GoodsCabinetPage() {
  const t = useI18n();
  const [tab, setTab] = useState<"catalog" | "stock" | "cash" | "purchases">("catalog");

  // ------- Каталог -------
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [goods, setGoods] = useState<GoodsInfo[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Управление категориями — тот же паттерн, что у категорий расходов
  // (/money/expenses, запрос пользователя 2026-07-19: "должно быть, как и в
  // категориях Расходов... интерфейс должен быть единообразный") — один
  // "Категории" bottom sheet со списком (инлайн-переименование, удаление),
  // без отдельного per-карточка kebab и без отдельного confirm-шага на
  // удаление (сервер и так отказывает, если в категории остались товары,
  // см. /api/goods/categories/[id] DELETE — ошибка всплывает через categoryError).
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const { saved: categorySaved, pulse: categoryPulse } = useSavePulse();

  const [goodsSheetOpen, setGoodsSheetOpen] = useState(false);
  const [editingGoodsId, setEditingGoodsId] = useState<string | null>(null);
  const [goodsForm, setGoodsForm] = useState(EMPTY_GOODS_FORM);
  const [goodsUploading, setGoodsUploading] = useState(false);
  const [goodsError, setGoodsError] = useState<string | null>(null);
  const { saved: goodsSaved, pulse: goodsPulse } = useSavePulse();
  const [goodsKebab, setGoodsKebab] = useState<GoodsInfo | null>(null);
  const [confirmArchiveGoods, setConfirmArchiveGoods] = useState(false);
  const { saved: goodsArchived, pulse: goodsArchivePulse } = useSavePulse();

  async function loadCatalog() {
    const [categoriesRes, goodsRes] = await Promise.all([fetch("/api/goods/categories"), fetch("/api/goods")]);
    const categoriesData = await categoriesRes.json();
    const goodsData = await goodsRes.json();
    setCategories(categoriesData.categories ?? []);
    setGoods(goodsData.goods ?? []);
    setLoadingCatalog(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadCatalog();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openCategories() {
    setEditingCategoryId(null);
    setNewCategoryName("");
    setCategoryError(null);
    setCategoriesOpen(true);
  }

  function startRenameCategory(c: CategoryInfo) {
    setEditingCategoryId(c.id);
    setEditingCategoryName(c.name);
    setCategoryError(null);
  }

  async function confirmRenameCategory() {
    if (!editingCategoryId || !editingCategoryName.trim()) return;
    const res = await fetch(`/api/goods/categories/${editingCategoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingCategoryName.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCategoryError(data.error ?? t.goods.categorySaveError);
      return;
    }
    await loadCatalog();
    categoryPulse(() => setEditingCategoryId(null));
  }

  async function deleteCategory(id: string) {
    setCategoryError(null);
    const res = await fetch(`/api/goods/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCategoryError(data.error ?? t.goods.categorySaveError);
      return;
    }
    await loadCatalog();
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    const res = await fetch("/api/goods/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCategoryError(data.error ?? t.goods.categorySaveError);
      return;
    }
    setNewCategoryName("");
    setCategoryError(null);
    await loadCatalog();
  }

  function openAddGoods(categoryId: string) {
    setEditingGoodsId(null);
    setGoodsForm({ ...EMPTY_GOODS_FORM, categoryId });
    setGoodsError(null);
    setGoodsSheetOpen(true);
  }

  function openEditGoods(g: GoodsInfo) {
    setEditingGoodsId(g.id);
    setGoodsForm({
      categoryId: g.categoryId,
      name: g.name,
      photoUrl: g.photoUrl,
      price: String(g.price),
      lowStockThreshold: g.lowStockThreshold !== null ? String(g.lowStockThreshold) : "",
      trackStock: g.trackStock,
    });
    setGoodsError(null);
    setGoodsSheetOpen(true);
  }

  async function handleGoodsPhotoUpload(file: File) {
    setGoodsUploading(true);
    setGoodsError(null);
    try {
      const compressed = await compressImageFile(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setGoodsError(data.error ?? "Не удалось загрузить фото");
        return;
      }
      setGoodsForm((f) => ({ ...f, photoUrl: data.url }));
    } finally {
      setGoodsUploading(false);
    }
  }

  async function saveGoods() {
    if (!goodsForm.name.trim()) {
      setGoodsError(t.goods.nameRequiredError);
      return;
    }
    const price = Number(goodsForm.price);
    if (!Number.isFinite(price) || price <= 0) {
      setGoodsError(t.goods.priceRequiredError);
      return;
    }
    const res = await fetch(editingGoodsId ? `/api/goods/${editingGoodsId}` : "/api/goods", {
      method: editingGoodsId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: goodsForm.categoryId,
        name: goodsForm.name.trim(),
        photoUrl: goodsForm.photoUrl,
        price,
        lowStockThreshold: goodsForm.lowStockThreshold.trim() ? Number(goodsForm.lowStockThreshold) : null,
        trackStock: goodsForm.trackStock,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setGoodsError(data.error ?? "Не удалось сохранить");
      return;
    }
    await loadCatalog();
    goodsPulse(() => setGoodsSheetOpen(false));
  }

  function openArchiveGoods(g: GoodsInfo) {
    setGoodsKebab(g);
    setConfirmArchiveGoods(true);
  }

  async function archiveGoods() {
    if (!goodsKebab) return;
    await fetch(`/api/goods/${goodsKebab.id}`, { method: "DELETE" });
    await loadCatalog();
    goodsArchivePulse(() => {
      setConfirmArchiveGoods(false);
      setGoodsKebab(null);
    });
  }

  // ------- Остатки -------
  const [points, setPoints] = useState<PointInfo[]>([]);
  const [pointId, setPointId] = usePersistedPointId();
  const [stockGoods, setStockGoods] = useState<StockGoods[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  // Фильтр по категории (запрос пользователя 2026-07-19: "чтобы все товары
  // не отображались огромным списком") — тот же принцип, что фильтр
  // категории на "Продажах".
  const [stockCategoryFilter, setStockCategoryFilter] = useState<string>("all");
  const [restockTarget, setRestockTarget] = useState<StockGoods | null>(null);
  const [restockQuantity, setRestockQuantity] = useState("");
  const [restockError, setRestockError] = useState<string | null>(null);
  const { saved: restockSaved, pulse: restockPulse } = useSavePulse();

  const [revisionSheetOpen, setRevisionSheetOpen] = useState(false);
  const [revisionCategory, setRevisionCategory] = useState<string | null>(null);
  const [revisionQuantities, setRevisionQuantities] = useState<Record<string, string>>({});
  // Черновики по категориям (запрос пользователя 2026-07-19: "а вдруг мне
  // надо несколько товаров по разным категориям изменить" — заходишь в
  // категорию, меняешь остатки, "Назад" к списку категорий, идёшь в другую;
  // на сервер всё уходит одним коммитом только по нажатию общего
  // "Сохранить" из списка категорий, не при заходе в каждую категорию).
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, Record<string, string>>>({});
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const { saved: revisionSaved, pulse: revisionPulse } = useSavePulse();
  const [revisions, setRevisions] = useState<RevisionEntry[]>([]);
  // День/Неделя/Месяц/Год/Период для Истории ревизий (запрос пользователя
  // 2026-07-19: "иначе список будет бесконечный" — тот же приём, что у
  // "Кассы"/"Продажи").
  const [revisionHistoryMode, setRevisionHistoryMode] = useState<"granularity" | "custom">("granularity");
  const [revisionHistoryGranularity, setRevisionHistoryGranularity] = useState<PeriodGranularity>("month");
  const [revisionHistoryAnchor, setRevisionHistoryAnchor] = useState(() => new Date());
  const [revisionHistoryCustomFrom, setRevisionHistoryCustomFrom] = useState(() => toDateStr(new Date()));
  const [revisionHistoryCustomTo, setRevisionHistoryCustomTo] = useState(() => toDateStr(new Date()));

  useEffect(() => {
    fetch("/api/points")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setPoints(data.points ?? []);
        setPointId((prev) => prev ?? data.points?.[0]?.id ?? null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadStock() {
    if (!pointId) return;
    setLoadingStock(true);
    const revisionParams = new URLSearchParams({ pointId });
    if (revisionHistoryMode === "custom") {
      revisionParams.set("from", revisionHistoryCustomFrom);
      revisionParams.set("to", revisionHistoryCustomTo);
    } else {
      revisionParams.set("granularity", revisionHistoryGranularity);
      revisionParams.set("anchor", toDateStr(revisionHistoryAnchor));
    }
    Promise.all([
      fetch(`/api/goods/stock?pointId=${pointId}`).then((res) => (res.ok ? res.json() : null)),
      fetch(`/api/goods/revisions?${revisionParams}`).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([stockData, revisionsData]) => {
        setStockGoods(stockData?.goods ?? []);
        setRevisions(revisionsData?.revisions ?? []);
      })
      .finally(() => setLoadingStock(false));
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (tab === "stock") loadStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pointId, revisionHistoryMode, revisionHistoryGranularity, revisionHistoryAnchor, revisionHistoryCustomFrom, revisionHistoryCustomTo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function isRevisionHistoryCurrentPeriod() {
    return isPeriodCurrent(revisionHistoryGranularity, revisionHistoryAnchor);
  }

  function stepRevisionHistoryPeriod(delta: number) {
    if (delta > 0 && isRevisionHistoryCurrentPeriod()) return;
    setRevisionHistoryAnchor(stepPeriodAnchor(revisionHistoryGranularity, revisionHistoryAnchor, delta));
  }

  function formatRevisionHistoryPeriodLabel() {
    return formatPeriodLabel(revisionHistoryGranularity, revisionHistoryAnchor, t);
  }

  function openRestock(g: StockGoods) {
    setRestockTarget(g);
    setRestockQuantity("");
    setRestockError(null);
  }

  async function saveRestock() {
    if (!restockTarget || !pointId) return;
    const quantity = Number(restockQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setRestockError(t.goods.quantityRequiredError);
      return;
    }
    const res = await fetch(`/api/goods/${restockTarget.id}/restock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointId, quantity }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRestockError(data.error ?? "Не удалось сохранить");
      return;
    }
    loadStock();
    restockPulse(() => setRestockTarget(null));
  }

  function openRevision() {
    setRevisionCategory(null);
    setRevisionQuantities({});
    setRevisionDrafts({});
    setRevisionError(null);
    setRevisionSheetOpen(true);
  }

  const revisionGoods = revisionCategory ? stockGoods.filter((g) => g.categoryId === revisionCategory) : [];

  function revisionLinesFor(categoryId: string, quantities: Record<string, string>) {
    return stockGoods
      .filter((g) => g.categoryId === categoryId)
      .map((g) => ({ goodsId: g.id, actualQuantity: Number(quantities[g.id]) }))
      .filter((l) => Number.isInteger(l.actualQuantity) && l.actualQuantity >= 0);
  }

  function categoryHasRevisionDraft(categoryId: string) {
    const draft = revisionDrafts[categoryId];
    return !!draft && revisionLinesFor(categoryId, draft).length > 0;
  }

  function openRevisionCategory(categoryId: string) {
    setRevisionQuantities(revisionDrafts[categoryId] ?? {});
    setRevisionCategory(categoryId);
  }

  function closeRevisionCategory() {
    if (revisionCategory) {
      setRevisionDrafts((prev) => ({ ...prev, [revisionCategory]: revisionQuantities }));
    }
    setRevisionCategory(null);
    setRevisionQuantities({});
  }

  async function saveAllRevisions() {
    if (!pointId) return;
    const groups = categories
      .map((c) => ({ categoryId: c.id, lines: revisionLinesFor(c.id, revisionDrafts[c.id] ?? {}) }))
      .filter((g) => g.lines.length > 0);
    if (groups.length === 0) {
      setRevisionError(t.goods.noTrackedGoods);
      return;
    }
    const res = await fetch("/api/goods/revisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointId, groups }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRevisionError(data.error ?? "Не удалось сохранить");
      return;
    }
    loadStock();
    revisionPulse(() => {
      setRevisionDrafts({});
      setRevisionSheetOpen(false);
    });
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const goodsByCategory = new Map<string, GoodsInfo[]>();
  for (const g of goods) {
    const list = goodsByCategory.get(g.categoryId) ?? [];
    list.push(g);
    goodsByCategory.set(g.categoryId, list);
  }

  // ------- Покупки -------
  // День/Неделя/Месяц/Год/Период — тот же выбор периода, что /money (запрос
  // пользователя 2026-07-19: "добавить как в Деньгах"), не просто листание
  // месяцев.
  const [salesMode, setSalesMode] = useState<"granularity" | "custom">("granularity");
  const [salesGranularity, setSalesGranularity] = useState<"day" | "week" | "month" | "year">("month");
  const [salesAnchor, setSalesAnchor] = useState(() => new Date());
  const [salesCustomFrom, setSalesCustomFrom] = useState(() => toDateStr(new Date()));
  const [salesCustomTo, setSalesCustomTo] = useState(() => toDateStr(new Date()));
  const [salesCategoryFilter, setSalesCategoryFilter] = useState<string>("all");
  const [salesGoodsFilter, setSalesGoodsFilter] = useState<string>("all");
  const [salesOperatorFilter, setSalesOperatorFilter] = useState<string>("all");
  const [salesMethodFilter, setSalesMethodFilter] = useState<string>("all");
  // Товары в фильтре "Продаж" сужены до выбранной категории (запрос
  // пользователя 2026-07-19) — тот же принцип, что categoryId у самого
  // Goods, товар физически не может принадлежать сразу двум категориям.
  const goodsForSalesFilter = salesCategoryFilter === "all" ? goods : goods.filter((g) => g.categoryId === salesCategoryFilter);
  const filteredStockGoods =
    stockCategoryFilter === "all" ? stockGoods : stockGoods.filter((g) => g.categoryId === stockCategoryFilter);
  const [operators, setOperators] = useState<OperatorInfo[]>([]);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [sales, setSales] = useState<SaleEntry[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [voidTarget, setVoidTarget] = useState<SaleEntry | null>(null);
  const { saved: voidSaved, pulse: voidPulse } = useSavePulse();

  // ------- Кассы -------
  // День/Неделя/Месяц/Год/Период — тот же выбор, что "Продажи" (запрос
  // пользователя 2026-07-19: "иначе список потом будет бесконечный"), плюс
  // график, как в "Отчёты → Динамика" (запрос того же дня: "наверное лучше
  // в таб Кассы, там он будет информативнее").
  const [cashMode, setCashMode] = useState<"granularity" | "custom">("granularity");
  const [cashGranularity, setCashGranularity] = useState<"day" | "week" | "month" | "year">("month");
  const [cashAnchor, setCashAnchor] = useState(() => new Date());
  const [cashCustomFrom, setCashCustomFrom] = useState(() => toDateStr(new Date()));
  const [cashCustomTo, setCashCustomTo] = useState(() => toDateStr(new Date()));
  const [cashBars, setCashBars] = useState<{ date: string; total: number; hasData: boolean }[]>([]);

  const [reconcilePending, setReconcilePending] = useState<{ cash: number; mobile: number; abonement: number } | null>(
    null
  );
  const [reconciliations, setReconciliations] = useState<ReconciliationEntry[]>([]);
  const [reconcileSheetOpen, setReconcileSheetOpen] = useState(false);
  const [reconcileCash, setReconcileCash] = useState("");
  const [reconcileMobile, setReconcileMobile] = useState("");
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const { saved: reconcileSaved, pulse: reconcilePulse } = useSavePulse();

  // Правка/удаление уже сохранённой сдачи кассы (запрос пользователя
  // 2026-07-19: "Владелец должен иметь возможность редактировать и удалять
  // Сдачи касс") — тот же паттерн kebab→sheet, что у товара (goodsKebab)
  // выше: меню "Изменить"/"Удалить" по клику на запись истории.
  const [reconciliationKebab, setReconciliationKebab] = useState<ReconciliationEntry | null>(null);
  const [editReconciliationOpen, setEditReconciliationOpen] = useState(false);
  const [editReconcileCash, setEditReconcileCash] = useState("");
  const [editReconcileMobile, setEditReconcileMobile] = useState("");
  const [editReconcileError, setEditReconcileError] = useState<string | null>(null);
  const { saved: editReconcileSaved, pulse: editReconcilePulse } = useSavePulse();
  const [confirmDeleteReconciliation, setConfirmDeleteReconciliation] = useState(false);
  const { saved: reconciliationDeleted, pulse: reconciliationDeletePulse } = useSavePulse();

  function loadSales() {
    setLoadingSales(true);
    const params = new URLSearchParams();
    if (salesMode === "custom") {
      params.set("from", salesCustomFrom);
      params.set("to", salesCustomTo);
    } else {
      params.set("granularity", salesGranularity);
      params.set("anchor", toDateStr(salesAnchor));
    }
    if (pointId) params.set("pointId", pointId);
    if (salesCategoryFilter !== "all") params.set("categoryId", salesCategoryFilter);
    if (salesGoodsFilter !== "all") params.set("goodsId", salesGoodsFilter);
    if (salesOperatorFilter !== "all") params.set("operatorId", salesOperatorFilter);
    if (salesMethodFilter !== "all") params.set("paymentMethod", salesMethodFilter);
    fetch(`/api/goods/sales?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setSalesSummary(data.summary ?? null);
        setSales(data.sales ?? []);
      })
      .finally(() => setLoadingSales(false));
  }

  function loadReconciliations() {
    if (!pointId) {
      setReconcilePending(null);
      setReconciliations([]);
      setCashBars([]);
      return;
    }
    const params = new URLSearchParams({ pointId });
    if (cashMode === "custom") {
      params.set("from", cashCustomFrom);
      params.set("to", cashCustomTo);
    } else {
      params.set("granularity", cashGranularity);
      params.set("anchor", toDateStr(cashAnchor));
    }
    fetch(`/api/goods/reconciliations?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setReconcilePending(data.pending ?? null);
        setReconciliations(data.reconciliations ?? []);
        setCashBars(data.bars ?? []);
      });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (tab !== "cash") return;
    loadReconciliations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pointId, cashMode, cashGranularity, cashAnchor, cashCustomFrom, cashCustomTo]);

  useEffect(() => {
    if (tab !== "purchases") return;
    loadSales();
    if (operators.length === 0) {
      fetch("/api/operators")
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (data: { operators?: { id: string; name: string; avatarUrl: string | null; iconKey: string | null; goodsAccess: boolean }[] } | null) =>
            // Только сотрудники, которым доступна продажа товаров (запрос
            // пользователя 2026-07-19: "в dropdown есть сотрудники, которым не
            // разрешена продажа товаров") — иначе фильтр предлагает выбрать
            // того, кто физически не мог совершить ни одной продажи товара.
            data && setOperators((data.operators ?? []).filter((o) => o.goodsAccess).map((o) => ({ id: o.id, name: o.name, avatarUrl: o.avatarUrl, iconKey: o.iconKey })))
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, salesMode, salesGranularity, salesAnchor, salesCustomFrom, salesCustomTo, pointId, salesCategoryFilter, salesGoodsFilter, salesOperatorFilter, salesMethodFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function isSalesCurrentPeriod() {
    return isPeriodCurrent(salesGranularity, salesAnchor);
  }

  function stepSalesPeriod(delta: number) {
    if (delta > 0 && isSalesCurrentPeriod()) return;
    setSalesAnchor(stepPeriodAnchor(salesGranularity, salesAnchor, delta));
  }

  function formatSalesPeriodLabel() {
    return formatPeriodLabel(salesGranularity, salesAnchor, t);
  }

  function isCashCurrentPeriod() {
    return isPeriodCurrent(cashGranularity, cashAnchor);
  }

  function stepCashPeriod(delta: number) {
    if (delta > 0 && isCashCurrentPeriod()) return;
    setCashAnchor(stepPeriodAnchor(cashGranularity, cashAnchor, delta));
  }

  function formatCashPeriodLabel() {
    return formatPeriodLabel(cashGranularity, cashAnchor, t);
  }

  function openReconcileSheet() {
    setReconcileCash("");
    setReconcileMobile("");
    setReconcileError(null);
    setReconcileSheetOpen(true);
  }

  async function saveReconcile() {
    if (!pointId) return;
    const actualCash = Number(reconcileCash || "0");
    const actualMobile = Number(reconcileMobile || "0");
    if (!Number.isFinite(actualCash) || actualCash < 0 || !Number.isFinite(actualMobile) || actualMobile < 0) {
      setReconcileError(t.goods.quantityRequiredError);
      return;
    }
    const res = await fetch("/api/goods/reconciliations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointId, actualCash, actualMobile }),
    });
    const data = await res.json();
    if (!res.ok) {
      setReconcileError(data.error ?? "Не удалось сохранить");
      return;
    }
    loadReconciliations();
    reconcilePulse(() => setReconcileSheetOpen(false));
  }

  function openEditReconciliation(r: ReconciliationEntry) {
    setReconciliationKebab(r);
    setEditReconcileCash(String(r.actualCash));
    setEditReconcileMobile(String(r.actualMobile));
    setEditReconcileError(null);
    setEditReconciliationOpen(true);
  }

  function openDeleteReconciliation(r: ReconciliationEntry) {
    setReconciliationKebab(r);
    setConfirmDeleteReconciliation(true);
  }

  async function saveEditReconciliation() {
    if (!reconciliationKebab) return;
    const actualCash = Number(editReconcileCash || "0");
    const actualMobile = Number(editReconcileMobile || "0");
    if (!Number.isFinite(actualCash) || actualCash < 0 || !Number.isFinite(actualMobile) || actualMobile < 0) {
      setEditReconcileError(t.goods.quantityRequiredError);
      return;
    }
    const res = await fetch(`/api/goods/reconciliations/${reconciliationKebab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actualCash, actualMobile }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEditReconcileError(data.error ?? "Не удалось сохранить");
      return;
    }
    loadReconciliations();
    editReconcilePulse(() => {
      setEditReconciliationOpen(false);
      setReconciliationKebab(null);
    });
  }

  async function deleteReconciliation() {
    if (!reconciliationKebab) return;
    const res = await fetch(`/api/goods/reconciliations/${reconciliationKebab.id}`, { method: "DELETE" });
    if (!res.ok) return;
    loadReconciliations();
    reconciliationDeletePulse(() => {
      setConfirmDeleteReconciliation(false);
      setReconciliationKebab(null);
    });
  }

  async function confirmVoidSale() {
    if (!voidTarget) return;
    const res = await fetch(`/api/goods/sale/${voidTarget.id}/void`, { method: "POST" });
    if (!res.ok) return;
    loadSales();
    loadStock();
    voidPulse(() => setVoidTarget(null));
  }

  const reconcileDifference =
    reconcilePending && (reconcileCash || reconcileMobile)
      ? Number(reconcileCash || "0") + Number(reconcileMobile || "0") - reconcilePending.cash - reconcilePending.mobile
      : null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <h1 className="text-screen-title">{t.goods.navLabel}</h1>

          <SegmentedTabs
            className="grid grid-cols-2"
            options={[
              { key: "catalog", label: t.goods.catalogTab },
              { key: "stock", label: t.goods.stockTab },
              { key: "cash", label: t.goods.salesTab },
              { key: "purchases", label: t.goods.purchasesTitle },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === "catalog" && !loadingCatalog && (
            <div className="flex flex-col gap-3">
              {/* Только "Категории" здесь (запрос пользователя 2026-07-19:
                  отдельная кнопка "Добавить" сверху не нужна — добавление
                  товара всегда идёт из конкретной категории, см. кнопку
                  внутри карточки категории ниже). */}
              <PressableScale className="self-end">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openCategories}>
                  <Settings2 className="size-4" />
                  {t.goods.categoriesButton}
                </Button>
              </PressableScale>

              {categories.length === 0 ? (
                <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.goods.emptyCatalog}</p>
              ) : (
                categories.map((c) => (
                  <SpringCard key={c.id} hover={false} className="flex flex-col gap-3">
                    <h2 className="text-card-title">{c.name}</h2>
                    <div className="flex flex-col gap-2">
                      {(goodsByCategory.get(c.id) ?? []).map((g) => {
                        const low = g.trackStock && g.lowStockThreshold !== null && (g.quantity ?? 0) <= g.lowStockThreshold;
                        return (
                        <div key={g.id} className="flex items-center gap-3">
                          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-control bg-primary/10">
                            {g.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={g.photoUrl} alt="" className="size-full object-contain object-center" />
                            ) : (
                              <ShoppingBag className="size-5 text-primary/50" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-body-airbnb font-semibold">{g.name}</p>
                            <p className={cn("tabular-nums text-[0.6875rem] leading-snug", low ? "font-bold text-destructive" : "text-muted-foreground")}>
                              {g.trackStock ? `${t.goods.catalogStockLabel}: ${g.quantity ?? 0}` : t.goods.serviceItemBadge}
                            </p>
                          </div>
                          <p className="shrink-0 tabular-nums text-body-airbnb font-semibold text-foreground">
                            <Money value={g.price} />
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <IconActionButton icon={Pencil} onClick={() => openEditGoods(g)} label={t.goods.editGoodsAction} />
                            <IconActionButton icon={Trash2} onClick={() => openArchiveGoods(g)} label={t.goods.archiveGoodsAction} destructive />
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    <PressableScale className="self-start">
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => openAddGoods(c.id)}>
                        <Plus className="size-4" />
                        {t.goods.addGoodsButton}
                      </Button>
                    </PressableScale>
                  </SpringCard>
                ))
              )}
            </div>
          )}

          {tab === "stock" && (
            <div className="flex flex-col gap-3">
              {/* Дропдаун точки растягивается, кнопка "Ревизия остатков" —
                  в том же ряду, компактная, в стиле "Категории" (запрос
                  пользователя 2026-07-19: "должна быть в один ряд с
                  dropdown"). */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Select value={pointId ?? ""} onValueChange={(v) => v && setPointId(v)} items={points.map((p) => ({ value: p.id, label: p.name }))}>
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
                </div>
                <PressableScale className="shrink-0">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openRevision} disabled={!pointId}>
                    <ClipboardList className="size-4" />
                    {t.goods.revisionTitle}
                  </Button>
                </PressableScale>
              </div>

              {/* Фильтр по категории (запрос пользователя 2026-07-19: "чтобы
                  все товары не отображались огромным списком"). */}
              {pointId && categories.length > 0 && (
                <Select
                  value={stockCategoryFilter}
                  onValueChange={(v) => v && setStockCategoryFilter(v)}
                  items={[{ value: "all", label: t.goods.allCategoriesFilterLabel }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {stockCategoryFilter === "all" ? t.goods.allCategoriesFilterLabel : categoryById.get(stockCategoryFilter)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.goods.allCategoriesFilterLabel}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {!pointId ? (
                <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.goods.selectPointHint}</p>
              ) : loadingStock ? null : filteredStockGoods.length === 0 ? (
                <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.goods.noTrackedGoods}</p>
              ) : (
                <SpringCard hover={false} className="flex flex-col gap-2">
                  {filteredStockGoods.map((g) => {
                    const low = g.lowStockThreshold !== null && g.quantity <= g.lowStockThreshold;
                    return (
                      <div key={g.id} className="flex items-center gap-3 border-t border-border pt-2.5 first:border-t-0 first:pt-0">
                        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-control bg-primary/10">
                          {g.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={g.photoUrl} alt="" className="size-full object-contain object-center" />
                          ) : (
                            <ShoppingBag className="size-5 text-primary/50" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-airbnb font-semibold">{g.name}</p>
                          <p className={cn("tabular-nums text-caption-airbnb", low ? "font-bold text-destructive" : "text-muted-foreground")}>
                            {g.quantity}
                            {low && ` · ${t.goods.lowStockBadge}`}
                          </p>
                        </div>
                        <PressableScale>
                          <Button type="button" variant="outline" size="sm" onClick={() => openRestock(g)}>
                            <Plus className="size-3.5" />
                            {t.goods.restockButton}
                          </Button>
                        </PressableScale>
                      </div>
                    );
                  })}
                </SpringCard>
              )}

              {pointId && (
                <div className="flex flex-col gap-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
                    {t.goods.revisionHistoryTitle}
                  </span>

                  {/* День/Неделя/Месяц/Год/Период — тот же приём, что у
                      "Кассы"/"Продажи" (запрос пользователя 2026-07-19:
                      "иначе список будет бесконечный"). */}
                  <div className="grid grid-cols-5 gap-1">
                    {(["day", "week", "month", "year"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setRevisionHistoryGranularity(g);
                          setRevisionHistoryAnchor(new Date());
                          setRevisionHistoryMode("granularity");
                        }}
                        className={cn(
                          "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                          revisionHistoryMode === "granularity" && g === revisionHistoryGranularity
                            ? "bg-primary/10 text-primary"
                            : "bg-surface-0 text-muted-foreground"
                        )}
                      >
                        {g === "day"
                          ? t.money.periodDay
                          : g === "week"
                            ? t.money.periodWeek
                            : g === "month"
                              ? t.money.periodMonth
                              : t.money.periodYear}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setRevisionHistoryMode("custom")}
                      className={cn(
                        "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                        revisionHistoryMode === "custom" ? "bg-primary/10 text-primary" : "bg-surface-0 text-muted-foreground"
                      )}
                    >
                      {t.money.periodCustom}
                    </button>
                  </div>

                  {revisionHistoryMode === "granularity" ? (
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        aria-label={t.money.prevPeriod}
                        onClick={() => stepRevisionHistoryPeriod(-1)}
                        className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                      >
                        <ChevronLeft className="size-4.5" />
                      </button>
                      <p className="text-caption-airbnb font-semibold text-foreground">{formatRevisionHistoryPeriodLabel()}</p>
                      <button
                        type="button"
                        aria-label={t.money.nextPeriod}
                        onClick={() => stepRevisionHistoryPeriod(1)}
                        disabled={isRevisionHistoryCurrentPeriod()}
                        className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                      >
                        <ChevronRight className="size-4.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={revisionHistoryCustomFrom}
                        max={revisionHistoryCustomTo}
                        onChange={(e) => setRevisionHistoryCustomFrom(e.target.value)}
                        className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                      />
                      <span className="text-caption-airbnb text-muted-foreground">—</span>
                      <input
                        type="date"
                        value={revisionHistoryCustomTo}
                        min={revisionHistoryCustomFrom}
                        max={toDateStr(new Date())}
                        onChange={(e) => setRevisionHistoryCustomTo(e.target.value)}
                        className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                      />
                    </div>
                  )}

                  {revisions.length === 0 ? (
                    <p className="text-caption-airbnb text-muted-foreground">{t.goods.noRevisionsYet}</p>
                  ) : (
                    revisions.map((r) => (
                      <SpringCard key={r.id} hover={false} animate={false} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between text-caption-airbnb text-muted-foreground">
                          <PerformedByTag name={r.performedBy} isOwner={r.performedByOwner} avatarUrl={r.performedByAvatarUrl} iconKey={r.performedByIconKey} t={t} />
                          <span>{new Date(r.occurredAt).toLocaleString()}</span>
                        </div>
                        {r.groups.map((group, gi) => (
                          <div key={gi} className="flex flex-col gap-1">
                            <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
                              {group.categoryName}
                            </span>
                            {group.lines.map((l, i) => (
                              <div key={i} className="flex items-center justify-between text-body-airbnb">
                                <span className="min-w-0 truncate">{l.goodsName}</span>
                                <span className="shrink-0 tabular-nums text-caption-airbnb">
                                  {t.goods.calculatedLabel} {l.calculatedQuantity} → {t.goods.actualLabel} {l.actualQuantity}
                                  {l.difference !== 0 && (
                                    <span className={l.difference > 0 ? "text-success" : "text-destructive"}>
                                      {" "}
                                      ({l.difference > 0 ? "+" : ""}
                                      {l.difference})
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </SpringCard>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* "Кассы" — точка обязательна (та же схема, что "Остатки", запрос
              пользователя 2026-07-19: "создадим ещё один там 'Покупки'... а
              таб 'Продажи' переименуем в 'Кассы'"), сдача/история кассы
              не имеет смысла как сводка "по всем точкам сразу". */}
          {tab === "cash" && (
            <div className="flex flex-col gap-3">
              {/* Дропдаун точки и "Сдать кассу" в один ряд (запрос
                  пользователя 2026-07-19: "как в 'Остатки'") — тот же
                  паттерн, что дропдаун + "Ревизия остатков" там. */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Select value={pointId ?? ""} onValueChange={(v) => v && setPointId(v)} items={points.map((p) => ({ value: p.id, label: p.name }))}>
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
                </div>
                <PressableScale className="shrink-0">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openReconcileSheet} disabled={!pointId}>
                    <Wallet2 className="size-3.5" />
                    {t.goods.reconciliationTitle}
                  </Button>
                </PressableScale>
              </div>

              {!pointId ? (
                <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.goods.selectPointHint}</p>
              ) : (
                <>
                  {/* День/Неделя/Месяц/Год/Период — тот же выбор, что
                      "Продажи" (запрос пользователя 2026-07-19: "иначе
                      список потом будет бесконечный"), плюс график, как в
                      "Отчёты → Динамика" (перенесён сюда из "Продажи" по
                      просьбе того же дня — "тут он будет информативнее"). */}
                  <div className="grid grid-cols-5 gap-1">
                    {(["day", "week", "month", "year"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setCashGranularity(g);
                          setCashAnchor(new Date());
                          setCashMode("granularity");
                        }}
                        className={cn(
                          "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                          cashMode === "granularity" && g === cashGranularity
                            ? "bg-primary/10 text-primary"
                            : "bg-surface-0 text-muted-foreground"
                        )}
                      >
                        {g === "day"
                          ? t.money.periodDay
                          : g === "week"
                            ? t.money.periodWeek
                            : g === "month"
                              ? t.money.periodMonth
                              : t.money.periodYear}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCashMode("custom")}
                      className={cn(
                        "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                        cashMode === "custom" ? "bg-primary/10 text-primary" : "bg-surface-0 text-muted-foreground"
                      )}
                    >
                      {t.money.periodCustom}
                    </button>
                  </div>

                  {cashMode === "granularity" ? (
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        aria-label={t.money.prevPeriod}
                        onClick={() => stepCashPeriod(-1)}
                        className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                      >
                        <ChevronLeft className="size-4.5" />
                      </button>
                      <p className="text-caption-airbnb font-semibold text-foreground">{formatCashPeriodLabel()}</p>
                      <button
                        type="button"
                        aria-label={t.money.nextPeriod}
                        onClick={() => stepCashPeriod(1)}
                        disabled={isCashCurrentPeriod()}
                        className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                      >
                        <ChevronRight className="size-4.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={cashCustomFrom}
                        max={cashCustomTo}
                        onChange={(e) => setCashCustomFrom(e.target.value)}
                        className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                      />
                      <span className="text-caption-airbnb text-muted-foreground">—</span>
                      <input
                        type="date"
                        value={cashCustomTo}
                        min={cashCustomFrom}
                        max={toDateStr(new Date())}
                        onChange={(e) => setCashCustomTo(e.target.value)}
                        className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                      />
                    </div>
                  )}

                  <GoodsBarsChart bars={cashBars} granularity={cashGranularity} t={t} />

                  <SpringCard hover={false} className="flex flex-col gap-2">
                    <h2 className="text-card-title">{t.goods.cashCardTitle}</h2>
                  {reconcilePending && (
                    <div className="flex items-center justify-between text-caption-airbnb tabular-nums text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                        {t.goods.calculatedCashLabel}: <Money value={reconcilePending.cash} />
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                        {t.goods.calculatedMobileLabel}: <Money value={reconcilePending.mobile} />
                      </span>
                    </div>
                  )}

                  {/* История сдач — внутри той же плашки "Кассы" (запрос
                      пользователя 2026-07-19: "надо внутри плашки 'Сверить
                      кассу'"), не отдельным блоком под списком продаж. */}
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
                      {t.goods.reconciliationHistoryTitle}
                    </span>
                    {reconciliations.length === 0 ? (
                      <p className="text-caption-airbnb text-muted-foreground">{t.goods.noReconciliationsYet}</p>
                    ) : (
                      reconciliations.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2 text-caption-airbnb tabular-nums">
                          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                            <span className="shrink-0">{new Date(r.occurredAt).toLocaleString()}</span>
                            <PerformedByTag name={r.performedBy} isOwner={r.performedByOwner} avatarUrl={r.performedByAvatarUrl} iconKey={r.performedByIconKey} t={t} />
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="inline-flex items-center gap-1">
                              <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                              <Money value={r.actualCash} />
                            </span>
                            +
                            <span className="inline-flex items-center gap-1">
                              <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                              <Money value={r.actualMobile} />
                            </span>
                            <IconActionButton icon={Pencil} onClick={() => openEditReconciliation(r)} label={t.goods.editGoodsAction} />
                            <IconActionButton icon={Trash2} onClick={() => openDeleteReconciliation(r)} label={t.common.delete} destructive />
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  </SpringCard>
                </>
              )}
            </div>
          )}

          {tab === "purchases" && (
            <div className="flex flex-col gap-3">
              {/* День/Неделя/Месяц/Год/Период — тот же выбор, что /money
                  (запрос пользователя 2026-07-19). */}
              <div className="grid grid-cols-5 gap-1">
                {(["day", "week", "month", "year"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setSalesGranularity(g);
                      setSalesAnchor(new Date());
                      setSalesMode("granularity");
                    }}
                    className={cn(
                      "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                      salesMode === "granularity" && g === salesGranularity
                        ? "bg-primary/10 text-primary"
                        : "bg-surface-0 text-muted-foreground"
                    )}
                  >
                    {g === "day"
                      ? t.money.periodDay
                      : g === "week"
                        ? t.money.periodWeek
                        : g === "month"
                          ? t.money.periodMonth
                          : t.money.periodYear}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSalesMode("custom")}
                  className={cn(
                    "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                    salesMode === "custom" ? "bg-primary/10 text-primary" : "bg-surface-0 text-muted-foreground"
                  )}
                >
                  {t.money.periodCustom}
                </button>
              </div>

              {salesMode === "granularity" ? (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    aria-label={t.money.prevPeriod}
                    onClick={() => stepSalesPeriod(-1)}
                    className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                  >
                    <ChevronLeft className="size-4.5" />
                  </button>
                  <p className="text-caption-airbnb font-semibold text-foreground">{formatSalesPeriodLabel()}</p>
                  <button
                    type="button"
                    aria-label={t.money.nextPeriod}
                    onClick={() => stepSalesPeriod(1)}
                    disabled={isSalesCurrentPeriod()}
                    className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                  >
                    <ChevronRight className="size-4.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={salesCustomFrom}
                    max={salesCustomTo}
                    onChange={(e) => setSalesCustomFrom(e.target.value)}
                    className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                  />
                  <span className="text-caption-airbnb text-muted-foreground">—</span>
                  <input
                    type="date"
                    value={salesCustomTo}
                    min={salesCustomFrom}
                    max={toDateStr(new Date())}
                    onChange={(e) => setSalesCustomTo(e.target.value)}
                    className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                  />
                </div>
              )}

              <Select value={pointId ?? "all"} onValueChange={(v) => setPointId(v === "all" ? null : v)} items={[{ value: "all", label: t.money.allPoints }, ...points.map((p) => ({ value: p.id, label: p.name }))]}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {(() => {
                        const iconKey = pointId ? points.find((p) => p.id === pointId)?.iconKey : null;
                        return iconKey ? (
                          <AssetOrZoneIcon iconKey={iconKey} className="size-5 shrink-0 text-muted-foreground" />
                        ) : (
                          <MapPin className="size-5 shrink-0 text-muted-foreground" />
                        );
                      })()}
                      {pointId ? points.find((p) => p.id === pointId)?.name : t.money.allPoints}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.money.allPoints}</SelectItem>
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

              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={salesCategoryFilter}
                  onValueChange={(v) => {
                    if (!v) return;
                    setSalesCategoryFilter(v);
                    // Сброс товара, если он не из новой категории (запрос
                    // пользователя 2026-07-19: "если выбрана категория
                    // Игрушки, то в ней не может быть товар Кофе") — иначе
                    // фильтр остаётся указывать на товар вне видимого списка.
                    if (v !== "all" && salesGoodsFilter !== "all" && goods.find((g) => g.id === salesGoodsFilter)?.categoryId !== v) {
                      setSalesGoodsFilter("all");
                    }
                  }}
                  items={[{ value: "all", label: t.goods.allCategoriesFilterLabel }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue>{salesCategoryFilter === "all" ? t.goods.allCategoriesFilterLabel : categoryById.get(salesCategoryFilter)?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.goods.allCategoriesFilterLabel}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={salesOperatorFilter} onValueChange={(v) => v && setSalesOperatorFilter(v)} items={[{ value: "all", label: t.goods.allOperatorsLabel }, ...operators.map((o) => ({ value: o.id, label: o.name }))]}>
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue>
                      {salesOperatorFilter === "all" ? (
                        t.goods.allOperatorsLabel
                      ) : (
                        (() => {
                          const op = operators.find((o) => o.id === salesOperatorFilter);
                          return op ? <PerformedByTag name={op.name} isOwner={false} avatarUrl={op.avatarUrl} iconKey={op.iconKey} t={t} /> : null;
                        })()
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.goods.allOperatorsLabel}</SelectItem>
                    {operators.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        <PerformedByTag name={o.name} isOwner={false} avatarUrl={o.avatarUrl} iconKey={o.iconKey} t={t} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={salesGoodsFilter}
                  onValueChange={(v) => v && setSalesGoodsFilter(v)}
                  items={[{ value: "all", label: t.goods.allGoodsLabel }, ...goodsForSalesFilter.map((g) => ({ value: g.id, label: g.name }))]}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue>{salesGoodsFilter === "all" ? t.goods.allGoodsLabel : goodsForSalesFilter.find((g) => g.id === salesGoodsFilter)?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.goods.allGoodsLabel}</SelectItem>
                    {goodsForSalesFilter.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={salesMethodFilter}
                  onValueChange={(v) => v && setSalesMethodFilter(v)}
                  items={[
                    { value: "all", label: t.goods.allMethodsLabel },
                    { value: "cash", label: t.operatorApp.submit.cashLabel },
                    { value: "mobile", label: t.operatorApp.submit.mobileLabel },
                    { value: "abonement", label: t.reports.abonementLabel },
                  ]}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue>
                      <span className="flex items-center gap-1.5">
                        {salesMethodFilter !== "all" && <PaymentMethodIcon method={salesMethodFilter} className="size-4 shrink-0 text-muted-foreground" />}
                        {salesMethodFilter === "all"
                          ? t.goods.allMethodsLabel
                          : salesMethodFilter === "cash"
                            ? t.operatorApp.submit.cashLabel
                            : salesMethodFilter === "mobile"
                              ? t.operatorApp.submit.mobileLabel
                              : t.reports.abonementLabel}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.goods.allMethodsLabel}</SelectItem>
                    <SelectItem value="cash">
                      <span className="flex items-center gap-1.5">
                        <PaymentMethodIcon method="cash" className="size-4 shrink-0 text-muted-foreground" />
                        {t.operatorApp.submit.cashLabel}
                      </span>
                    </SelectItem>
                    <SelectItem value="mobile">
                      <span className="flex items-center gap-1.5">
                        <PaymentMethodIcon method="mobile" className="size-4 shrink-0 text-muted-foreground" />
                        {t.operatorApp.submit.mobileLabel}
                      </span>
                    </SelectItem>
                    <SelectItem value="abonement">
                      <span className="flex items-center gap-1.5">
                        <PaymentMethodIcon method="abonement" className="size-4 shrink-0 text-muted-foreground" />
                        {t.reports.abonementLabel}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {salesSummary && (
                <SpringCard hover={false} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-caption-airbnb text-muted-foreground">{t.goods.salesCountLabel}</span>
                    <span className="tabular-nums font-bold">{salesSummary.count}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-caption-airbnb text-muted-foreground">{t.money.revenue}</span>
                    <span className="text-xl font-extrabold tabular-nums tracking-[-0.02em]">
                      <Money value={salesSummary.revenue} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-caption-airbnb tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                      {t.operatorApp.submit.cashLabel}: <span className="font-bold text-foreground"><Money value={salesSummary.cash} /></span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                      {t.operatorApp.submit.mobileLabel}: <span className="font-bold text-foreground"><Money value={salesSummary.mobile} /></span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <PaymentMethodIcon method="abonement" className="size-3.5 shrink-0" />
                      {t.reports.abonementLabel}: <span className="font-bold text-foreground"><Money value={salesSummary.abonement} /></span>
                    </span>
                  </div>
                </SpringCard>
              )}

              {loadingSales ? null : sales.length === 0 ? (
                <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.goods.noSalesYet}</p>
              ) : (
                <SpringCard hover={false} className="flex flex-col gap-2">
                  <h2 className="text-card-title">{t.goods.purchasesTitle}</h2>
                  {sales.map((s) => (
                    <div
                      key={s.id}
                      className={cn(
                        "flex items-center gap-2 border-t border-border pt-2.5 first:border-t-0 first:pt-0",
                        s.voidedAt && "opacity-40"
                      )}
                    >
                      <PaymentMethodIcon method={s.paymentMethod} className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-airbnb font-semibold">
                          {s.goodsName} × {s.quantity}
                          {s.voidedAt && ` · ${t.goods.voided}`}
                        </p>
                        <p className="flex flex-wrap items-center gap-x-1 text-caption-airbnb text-muted-foreground">
                          <span>{new Date(s.occurredAt).toLocaleString()}</span>
                          {!pointId && (
                            <span className="inline-flex items-center gap-1">
                              ·
                              {s.pointIconKey ? (
                                <AssetOrZoneIcon iconKey={s.pointIconKey} className="size-3.5 shrink-0" />
                              ) : (
                                <MapPin className="size-3.5 shrink-0" />
                              )}
                              {s.pointName}
                            </span>
                          )}
                          {(s.performedBy || s.performedByOwner) && (
                            <span className="inline-flex items-center gap-1">
                              ·
                              <PerformedByTag name={s.performedBy} isOwner={s.performedByOwner} avatarUrl={s.performedByAvatarUrl} iconKey={s.performedByIconKey} t={t} />
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 font-bold tabular-nums">
                        <Money value={s.amount} />
                      </span>
                      {!s.voidedAt && (
                        <IconActionButton icon={Trash2} onClick={() => setVoidTarget(s)} label={t.goods.voidAction} destructive />
                      )}
                    </div>
                  ))}
                </SpringCard>
              )}

            </div>
          )}
        </div>
      </div>

      {/* ------- Sheet: категории (единый список — тот же паттерн, что
          /money/expenses "Категории", запрос пользователя 2026-07-19) ------- */}
      <BottomSheet open={categoriesOpen} onClose={() => setCategoriesOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.categoriesTitle}</h2>
          {categories.length === 0 ? (
            <p className="text-caption-airbnb text-muted-foreground">{t.goods.noCategoriesYet}</p>
          ) : (
            <div className="flex max-h-72 flex-col overflow-y-auto">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center gap-2 border-t border-border py-2 first:border-t-0">
                  {editingCategoryId === c.id ? (
                    <>
                      <Input
                        autoFocus
                        value={editingCategoryName}
                        onChange={(e) => setEditingCategoryName(e.target.value)}
                        className="h-9 flex-1"
                      />
                      <PressableScale>
                        <SaveButton size="sm" onClick={confirmRenameCategory} saved={categorySaved} />
                      </PressableScale>
                      <button
                        type="button"
                        onClick={() => setEditingCategoryId(null)}
                        className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-body-airbnb">{c.name}</span>
                      <IconActionButton icon={Pencil} onClick={() => startRenameCategory(c)} label={t.goods.editGoodsAction} />
                      <IconActionButton icon={Trash2} onClick={() => deleteCategory(c.id)} label={t.common.delete} destructive />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {categoryError && <p className="text-sm text-destructive">{categoryError}</p>}
          <div className="flex gap-2 border-t border-border pt-3">
            <Input
              placeholder={t.goods.newCategoryPlaceholder}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="h-10 flex-1"
            />
            <PressableScale>
              <Button size="icon" onClick={addCategory} aria-label={t.common.add}>
                <Plus className="size-4" />
              </Button>
            </PressableScale>
          </div>
        </div>
      </BottomSheet>

      {/* ------- Sheets: товар ------- */}
      <BottomSheet open={goodsSheetOpen} onClose={() => setGoodsSheetOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {editingGoodsId ? t.goods.editGoodsAction : t.goods.addGoodsButton}
          </h2>

          <div className="flex flex-col gap-1">
            <Label>{t.goods.photoLabel}</Label>
            <div className="flex flex-wrap items-center gap-3">
              {goodsForm.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={goodsForm.photoUrl} alt="" className="size-12 rounded-control object-cover" />
              )}
              <PressableScale>
                <FilePickerButton
                  accept="image/jpeg,image/png,image/webp"
                  onFileSelected={handleGoodsPhotoUpload}
                  disabled={goodsUploading}
                  hasFile={!!goodsForm.photoUrl}
                />
              </PressableScale>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="goodsName">{t.goods.nameLabel}</Label>
            <Input
              id="goodsName"
              value={goodsForm.name}
              onChange={(e) => setGoodsForm((f) => ({ ...f, name: e.target.value }))}
              className="h-12"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="goodsCategory">{t.goods.categoryLabel}</Label>
            <Select
              value={goodsForm.categoryId}
              onValueChange={(v) => v && setGoodsForm((f) => ({ ...f, categoryId: v }))}
              items={categories.map((c) => ({ value: c.id, label: c.name }))}
            >
              <SelectTrigger className="h-12 w-full">
                <SelectValue>{categoryById.get(goodsForm.categoryId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="goodsPrice">{t.goods.priceLabel}</Label>
            <div className="flex">
              <MoneyInput
                id="goodsPrice"
                value={goodsForm.price}
                onChange={(e) => setGoodsForm((f) => ({ ...f, price: e.target.value.replace(/[^\d.]/g, "") }))}
                className="h-12"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
            <div className="min-w-0">
              <p className="text-body-airbnb font-semibold">{t.goods.trackStockLabel}</p>
              <p className="text-caption-airbnb text-muted-foreground">{t.goods.trackStockHint}</p>
            </div>
            <Switch
              checked={goodsForm.trackStock}
              onCheckedChange={(v) => setGoodsForm((f) => ({ ...f, trackStock: v }))}
              className="shrink-0"
            />
          </div>

          {goodsForm.trackStock && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="goodsLowStock">{t.goods.lowStockThresholdLabel}</Label>
              <Input
                id="goodsLowStock"
                inputMode="numeric"
                value={goodsForm.lowStockThreshold}
                onChange={(e) => setGoodsForm((f) => ({ ...f, lowStockThreshold: e.target.value.replace(/\D/g, "") }))}
                className="h-12"
              />
              <span className="text-caption-airbnb text-muted-foreground">{t.goods.lowStockThresholdHint}</span>
            </div>
          )}

          {goodsError && <p className="text-sm text-destructive">{goodsError}</p>}
          <PressableScale>
            <SaveButton type="button" className="h-12 w-full" saved={goodsSaved} onClick={saveGoods} />
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmArchiveGoods} onClose={() => setConfirmArchiveGoods(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.archiveGoodsAction}</h2>
          <p className="text-body-airbnb">{t.goods.confirmArchiveGoods}</p>
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={archiveGoods} deleted={goodsArchived} />
          </PressableScale>
        </div>
      </BottomSheet>

      {/* ------- Sheets: Остатки ------- */}
      <BottomSheet open={restockTarget !== null} onClose={() => setRestockTarget(null)}>
        {restockTarget && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.restockSheetTitle}</h2>
            <p className="text-caption-airbnb text-muted-foreground">
              {restockTarget.name} · {t.goods.calculatedLabel}: {restockTarget.quantity}
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="restockQty">{t.goods.quantityLabel}</Label>
              <Input
                id="restockQty"
                inputMode="numeric"
                autoFocus
                value={restockQuantity}
                onChange={(e) => setRestockQuantity(e.target.value.replace(/\D/g, ""))}
                className="h-12"
              />
            </div>
            {restockError && <p className="text-sm text-destructive">{restockError}</p>}
            <PressableScale>
              <SaveButton type="button" className="h-12 w-full" saved={restockSaved} onClick={saveRestock} />
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={revisionSheetOpen}
        onClose={() => {
          setRevisionSheetOpen(false);
          setRevisionCategory(null);
          setRevisionDrafts({});
        }}
      >
        <div className="flex flex-col gap-3 pt-2">
          {!revisionCategory ? (
            <>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.revisionTitle}</h2>
              <div className="flex flex-col gap-2">
                {categories.map((c) => (
                  <PressableScale key={c.id}>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 w-full justify-between font-semibold"
                      onClick={() => openRevisionCategory(c.id)}
                    >
                      {c.name}
                      {categoryHasRevisionDraft(c.id) && <Check className="size-4 shrink-0 text-primary" />}
                    </Button>
                  </PressableScale>
                ))}
              </div>
              {revisionError && <p className="text-sm text-destructive">{revisionError}</p>}
              <PressableScale>
                <SaveButton type="button" className="h-12 w-full" saved={revisionSaved} onClick={saveAllRevisions} />
              </PressableScale>
            </>
          ) : (
            <>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{categoryById.get(revisionCategory)?.name}</h2>
              {revisionGoods.length === 0 ? (
                <p className="text-caption-airbnb text-muted-foreground">{t.goods.noTrackedGoods}</p>
              ) : (
                <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
                  {revisionGoods.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-airbnb font-semibold">{g.name}</p>
                        <p className="text-caption-airbnb text-muted-foreground">
                          {t.goods.calculatedLabel}: {g.quantity}
                        </p>
                      </div>
                      <Input
                        inputMode="numeric"
                        value={revisionQuantities[g.id] ?? ""}
                        onChange={(e) => setRevisionQuantities((prev) => ({ ...prev, [g.id]: e.target.value.replace(/\D/g, "") }))}
                        placeholder={String(g.quantity)}
                        className="h-11 w-20 rounded-control bg-muted text-center tabular-nums"
                      />
                    </div>
                  ))}
                </div>
              )}
              <PressableScale>
                <Button type="button" variant="outline" className="h-12 w-full gap-1.5 font-bold" onClick={closeRevisionCategory}>
                  <ChevronLeft className="size-4" />
                  {t.common.back}
                </Button>
              </PressableScale>
            </>
          )}
        </div>
      </BottomSheet>

      {/* ------- Sheets: Продажи ------- */}
      {/* Тот же паттерн, что sheet "Сдать кассу" у Сотрудника
          (/operator/goods, запрос пользователя 2026-07-19: "по аналогии как
          у Сотрудника") — расчётная сумма крупно слева, разбивка справа,
          поля Наличные/Безнал + растянутая кнопка справа, разница снизу; те
          же ключи t.operatorApp.submit.*, не свои формулировки. */}
      <BottomSheet open={reconcileSheetOpen} onClose={() => setReconcileSheetOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.reconciliationTitle}</h2>
          {reconcilePending && (
            <div className="flex items-start justify-between gap-2 rounded-control bg-muted p-3.5">
              <div className="flex min-w-0 flex-col tabular-nums">
                <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.submit.calculatedRevenue}</span>
                <span className="text-xl font-extrabold leading-none tracking-[-0.02em]">
                  <Money value={reconcilePending.cash + reconcilePending.mobile + reconcilePending.abonement} />
                </span>
              </div>
              <div className="flex min-w-0 flex-col items-end gap-0.5 pt-1 text-right text-caption-airbnb tabular-nums">
                <span>
                  {t.operatorApp.submit.cashLabel}:{" "}
                  <span className="font-bold text-foreground">
                    <Money value={reconcilePending.cash} />
                  </span>
                </span>
                <span>
                  {t.operatorApp.submit.mobileLabel}:{" "}
                  <span className="font-bold text-foreground">
                    <Money value={reconcilePending.mobile} />
                  </span>
                </span>
                {reconcilePending.abonement > 0 && (
                  <span>
                    {t.operatorApp.abonement.paymentLabel}:{" "}
                    <span className="font-bold text-foreground">
                      <Money value={reconcilePending.abonement} />
                    </span>
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-stretch gap-2">
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="ownerReconcileCash">{t.operatorApp.submit.cashLabel}</Label>
                <MoneyInput
                  id="ownerReconcileCash"
                  autoFocus
                  scale="lg"
                  inputMode="numeric"
                  className="h-14 rounded-control bg-muted text-lg font-bold"
                  value={reconcileCash}
                  onChange={(e) => setReconcileCash(e.target.value.replace(/[^\d.]/g, ""))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ownerReconcileMobile">{t.operatorApp.submit.mobileLabel}</Label>
                <MoneyInput
                  id="ownerReconcileMobile"
                  scale="lg"
                  inputMode="numeric"
                  className="h-14 rounded-control bg-muted text-lg font-bold"
                  value={reconcileMobile}
                  onChange={(e) => setReconcileMobile(e.target.value.replace(/[^\d.]/g, ""))}
                />
              </div>
            </div>
            <PressableScale className="flex">
              <SaveButton
                className="h-full min-w-22 rounded-control px-5 font-bold"
                saved={reconcileSaved}
                onClick={saveReconcile}
              />
            </PressableScale>
          </div>

          {reconcileDifference !== null && (
            <p
              className={cn(
                "text-caption-airbnb font-semibold tabular-nums",
                reconcileDifference === 0 ? "text-primary" : "text-warning"
              )}
            >
              {t.operatorApp.submit.difference} {reconcileDifference > 0 ? "+" : ""}
              <Money value={reconcileDifference} />
            </p>
          )}

          {reconcileError && <p className="text-sm text-destructive">{reconcileError}</p>}
        </div>
      </BottomSheet>

      {/* ------- Sheets: правка/удаление сохранённой сдачи кассы (запрос
          пользователя 2026-07-19) — сразу две кнопки-иконки на строке
          истории вместо кебаб-меню, см. IconActionButton выше. ------- */}
      <BottomSheet open={editReconciliationOpen} onClose={() => setEditReconciliationOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.reconciliationTitle}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="editReconcileCash">{t.goods.actualCashLabel}</Label>
            <Input
              id="editReconcileCash"
              inputMode="decimal"
              value={editReconcileCash}
              onChange={(e) => setEditReconcileCash(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="editReconcileMobile">{t.goods.actualMobileLabel}</Label>
            <Input
              id="editReconcileMobile"
              inputMode="decimal"
              value={editReconcileMobile}
              onChange={(e) => setEditReconcileMobile(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12"
            />
          </div>
          {editReconcileError && <p className="text-sm text-destructive">{editReconcileError}</p>}
          <PressableScale>
            <SaveButton type="button" className="h-12 w-full" saved={editReconcileSaved} onClick={saveEditReconciliation} />
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmDeleteReconciliation} onClose={() => setConfirmDeleteReconciliation(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.common.delete}</h2>
          <p className="text-body-airbnb">{t.goods.confirmDeleteReconciliation}</p>
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={deleteReconciliation} deleted={reconciliationDeleted} />
          </PressableScale>
        </div>
      </BottomSheet>

      {/* Без поля причины (запрос пользователя 2026-07-19: "владельцам нет
          смысла спрашивать причину, продажа аннулируется и исчезает") —
          аннулировать продажу может только сам владелец
          (docs/spec/09-goods.md, "Аннулирование"; см. void/route.ts), никому
          отчитываться о причине ему не нужно. */}
      <BottomSheet open={voidTarget !== null} onClose={() => setVoidTarget(null)}>
        {voidTarget && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.voidAction}</h2>
            <p className="text-body-airbnb">{t.goods.confirmVoidSale}</p>
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={confirmVoidSale} deleted={voidSaved} />
            </PressableScale>
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}
