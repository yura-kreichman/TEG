"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronLeft,
  ChevronRight,
  Frown,
  Lightbulb,
  MapPin,
  Meh,
  Smile,
} from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { useI18n, useLocale, useCurrency } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { formatMoneyCompact } from "@/lib/format";
import { getCurrencySign } from "@/lib/currency";
import { toDateStr } from "@/lib/datetime-format";
import { cn } from "@/lib/utils";

type Tab = "dynamics" | "zones" | "operators" | "calendar";
type Granularity = "week" | "month" | "year";

interface DynamicsData {
  pointName: string;
  period: { granularity: Granularity };
  total: number;
  cash: number;
  mobile: number;
  submissionsCount: number;
  deltaPercent: number | null;
  bars: { date: string; total: number; profit: number }[];
  profitAndLoss: { revenue: number; expenses: number; payouts: number; profit: number };
}

interface ZonesData {
  zoneRanking: { zoneId: string; zoneName: string; iconKey: string | null; total: number; sharePercent: number }[];
  drillZoneId: string | null;
  drillZoneName: string | null;
  assetRanking: { assetId: string; assetName: string; colorTag: string; total: number; sharePercent: number }[];
  tariffBreakdown: { tariffId: string; tariffName: string; total: number; sharePercent: number }[];
  insight: { type: "lowAssetShare"; assetName: string; sharePercent: number; expectedSharePercent: number } | null;
}

interface OperatorRow {
  operatorId: string;
  name: string;
  colorTag: string | null;
  avatarUrl: string | null;
  iconKey: string | null;
  shiftsCount: number;
  totalHours: number;
  revenue: number;
  revenuePerHour: number | null;
  accruedForPeriod: number;
  differenceSum: number;
  hasNegativeStreak: boolean;
}

interface CalendarData {
  weeks: { weekStart: string; days: { date: string; dayOfWeek: number; total: number; hasData: boolean }[] }[];
  months: { month: number; total: number; hasData: boolean }[] | null;
}

export default function ReportsDashboardPage({ params }: { params: Promise<{ pointId: string }> }) {
  const { pointId } = use(params);
  const router = useRouter();
  const t = useI18n();

  const [checking, setChecking] = useState(true);
  const [pointName, setPointName] = useState("");
  const [points, setPoints] = useState<{ id: string; name: string; iconKey: string | null }[]>([]);
  const [tab, setTab] = useState<Tab>("dynamics");
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [anchor, setAnchor] = useState(() => new Date());

  const [dynamics, setDynamics] = useState<DynamicsData | null>(null);
  const [zones, setZones] = useState<ZonesData | null>(null);
  const [operators, setOperators] = useState<OperatorRow[] | null>(null);
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [zoneIdOverride, setZoneIdOverride] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function loadPeriodData() {
    setLoadError(false);
    const zoneParam = zoneIdOverride ? `&zoneId=${zoneIdOverride}` : "";
    const anchorParam = `&anchor=${toDateStr(anchor)}`;
    const [dynRes, zonesRes, opsRes] = await Promise.all([
      fetch(`/api/points/${pointId}/reports/dynamics?granularity=${granularity}${anchorParam}`),
      fetch(`/api/points/${pointId}/reports/zones?granularity=${granularity}${anchorParam}${zoneParam}`),
      fetch(`/api/points/${pointId}/reports/operators?granularity=${granularity}${anchorParam}`),
    ]);
    if (dynRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (dynRes.status === 404) {
      router.replace("/reports");
      return;
    }
    if (!dynRes.ok || !zonesRes.ok || !opsRes.ok) {
      setLoadError(true);
      setChecking(false);
      return;
    }
    const dynData = await dynRes.json();
    setDynamics(dynData);
    setPointName(dynData.pointName ?? t.money.allPoints);
    setZones(await zonesRes.json());
    const opsData = await opsRes.json();
    setOperators(opsData.operators ?? []);
    setChecking(false);
  }

  async function loadCalendar() {
    const res = await fetch(`/api/points/${pointId}/reports/calendar?granularity=${granularity}&anchor=${toDateStr(anchor)}`);
    if (res.ok) setCalendar(await res.json());
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadPeriodData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, granularity, anchor, zoneIdOverride]);

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, granularity, anchor]);

  // Список точек для дропдауна выбора — без отдельного экрана-пикера
  // (фидбек пользователя 2026-07-13). Загружается один раз, не зависит от pointId.
  useEffect(() => {
    fetch("/api/points")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data)
          setPoints(
            (data.points ?? []).map((p: { id: string; name: string; iconKey: string | null }) => ({
              id: p.id,
              name: p.name,
              iconKey: p.iconKey,
            })),
          );
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Перелистывание периода стрелками — тот же приём, что на /money (anchor +
  // stepPeriod/isCurrentPeriod), запрос пользователя 2026-07-16. Здесь только
  // week/month/year (нет "день", в отличие от /money), поэтому веток меньше.
  function isCurrentPeriod() {
    const today = new Date();
    if (granularity === "year") return anchor.getUTCFullYear() === today.getUTCFullYear();
    if (granularity === "month") {
      return anchor.getUTCFullYear() === today.getUTCFullYear() && anchor.getUTCMonth() === today.getUTCMonth();
    }
    const weekStart = (d: Date) => {
      const day = (d.getUTCDay() + 6) % 7;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
    };
    return weekStart(anchor) === weekStart(today);
  }

  function stepPeriod(delta: number) {
    if (delta > 0 && isCurrentPeriod()) return;
    const next = new Date(anchor);
    if (granularity === "week") next.setUTCDate(next.getUTCDate() + delta * 7);
    else if (granularity === "month") next.setUTCMonth(next.getUTCMonth() + delta);
    else next.setUTCFullYear(next.getUTCFullYear() + delta);
    setAnchor(next);
  }

  function formatPeriodLabel() {
    if (granularity === "year") return String(anchor.getUTCFullYear());
    if (granularity === "month") return `${t.readings.months[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
    const day = (anchor.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - day));
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    return sameMonth
      ? `${start.getUTCDate()}–${end.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]}`
      : `${start.getUTCDate()} ${t.readings.monthsGenitive[start.getUTCMonth()]} – ${end.getUTCDate()} ${t.readings.monthsGenitive[end.getUTCMonth()]}`;
  }

  if (checking) return null;

  const TABS: { key: Tab; label: string }[] = [
    { key: "dynamics", label: t.reports.tabDynamics },
    { key: "zones", label: t.reports.tabZones },
    { key: "operators", label: t.reports.tabOperators },
    { key: "calendar", label: t.reports.tabCalendar },
  ];

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <h1 className="text-screen-title">{t.reports.pickPointTitle}</h1>
          {points.length > 1 ? (
            <div className="mb-4">
              <Select
                value={pointId}
                onValueChange={(v) => v && router.push(`/reports/${v}`)}
                items={[
                  { value: "all", label: t.money.allPoints },
                  ...points.map((p) => ({ value: p.id, label: p.name })),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {(() => {
                        if (pointId === "all") return <Building2 className="size-6 shrink-0 text-muted-foreground" />;
                        const current = points.find((p) => p.id === pointId);
                        return current?.iconKey ? (
                          <AssetOrZoneIcon iconKey={current.iconKey} className="size-6 shrink-0" />
                        ) : (
                          <MapPin className="size-6 shrink-0 text-muted-foreground" />
                        );
                      })()}
                      {pointName}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center gap-2">
                      <Building2 className="size-6 shrink-0 text-muted-foreground" />
                      {t.money.allPoints}
                    </span>
                  </SelectItem>
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
            <p className="mb-4 text-caption-airbnb">{pointName}</p>
          )}

          <SegmentedTabs
            className="mb-4 grid grid-cols-2"
            equalWidth
            size="sm"
            options={TABS.map((tb) => ({ key: tb.key, label: tb.label }))}
            value={tab}
            onChange={setTab}
          />

          <SegmentedTabs
            className="mb-4"
            shape="control"
            options={[
              { key: "week" as Granularity, label: t.reports.periodWeek },
              { key: "month" as Granularity, label: t.reports.periodMonth },
              { key: "year" as Granularity, label: t.reports.periodYear },
            ]}
            value={granularity}
            onChange={setGranularity}
          />

          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              aria-label={t.money.prevPeriod}
              onClick={() => stepPeriod(-1)}
              className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
            >
              <ChevronLeft className="size-4.5" />
            </button>
            <p className="text-caption-airbnb font-semibold text-foreground">{formatPeriodLabel()}</p>
            <button
              type="button"
              aria-label={t.money.nextPeriod}
              onClick={() => stepPeriod(1)}
              disabled={isCurrentPeriod()}
              className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4.5" />
            </button>
          </div>

          {loadError ? (
            <p className="text-body-airbnb text-destructive">{t.reports.genericError}</p>
          ) : (
            <>
              {tab === "dynamics" && dynamics && <DynamicsTab data={dynamics} t={t} />}
              {tab === "zones" && zones && (
                <ZonesTab data={zones} t={t} onDrillZoneChange={setZoneIdOverride} />
              )}
              {tab === "operators" && operators && <OperatorsTab operators={operators} t={t} />}
              {tab === "calendar" && calendar && <CalendarTab data={calendar} t={t} />}
            </>
          )}
        </div>
      </div>
    </OwnerShell>
  );
}

function Delta({ percent, t }: { percent: number | null; t: ReturnType<typeof useI18n> }) {
  if (percent === null) return null;
  const up = percent >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
        up ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
      )}
    >
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {up ? "+" : ""}
      {percent}% {t.reports.vsPreviousPeriodSuffix}
    </span>
  );
}

// Минимальная ширина колонки графика (px) — при "Неделя"/"Год" (≤12 колонок)
// не задействуется, flex растягивает их на всю ширину плашки как раньше; при
// "Месяц" (до 31) колонки упираются в этот минимум и контейнер начинает
// скроллиться по горизонтали, а не сжимать столбцы до нечитаемости (запрос
// пользователя 2026-07-16: "у тебя будет 31 день в этом графике").
const CHART_COLUMN_MIN_WIDTH = 36;

function DynamicsTab({ data, t }: { data: DynamicsData; t: ReturnType<typeof useI18n> }) {
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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // По умолчанию скролл сразу в конец периода — там последние (обычно
    // единственные заполненные) дни, а не в начало пустого месяца (запрос
    // пользователя 2026-07-16). Мгновенно, без behavior:"smooth" — это
    // начальная позиция, а не пользовательское действие.
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    updateScrollState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.bars]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function scrollChart(direction: 1 | -1) {
    scrollRef.current?.scrollBy({ left: direction * 150, behavior: "smooth" });
  }

  if (data.submissionsCount === 0) {
    return <p className="text-body-airbnb text-muted-foreground">{t.reports.noDataForPeriod}</p>;
  }

  // Единая система координат для обеих линий (запрос пользователя
  // 2026-07-16: "и Выручку, и Прибыль двумя разными цветами") — прибыль за
  // отдельный день теоретически может уйти в минус (расходы/выплаты больше
  // выручки за день), поэтому домен считается по обеим сериям.
  const minVal = Math.min(0, ...data.bars.map((b) => b.profit));
  const maxVal = Math.max(1, ...data.bars.flatMap((b) => [b.total, b.profit]));
  const yFor = (v: number) => 100 - ((v - minVal) / (maxVal - minVal)) * 100;

  return (
    <div className="flex flex-col gap-3">
      <SpringCard animate={false} hover={false}>
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="flex flex-col">
            <span className="text-caption-airbnb text-muted-foreground">{t.reports.revenueLabel}</span>
            <span className="text-[2rem] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
              <Money value={data.total} size="display" />
            </span>
          </div>
          {/* Прибыль — ощутимо дальше от выручки, ближе к середине плашки,
              не сразу вплотную (запрос пользователя 2026-07-16), поэтому
              gap-10, а не gap-4. Delta прижата вправо через ml-auto —
              независимо от того, есть ли она вообще (percent===null → null),
              позиция Прибыли от этого не зависит. */}
          <div className="ml-10 flex flex-col">
            <span className="text-caption-airbnb text-muted-foreground">{t.reports.profitLabel}</span>
            <span className="text-[2rem] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
              <Money value={data.profitAndLoss.profit} size="display" />
            </span>
          </div>
          <div className="ml-auto">
            <Delta percent={data.deltaPercent} t={t} />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3 text-caption-airbnb text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full bg-primary" />
            {t.reports.revenueLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full bg-success" />
            {t.reports.profitLabel}
          </span>
        </div>

        <div className="relative mt-4">
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
            {/* CSS grid, не flex — общий gridTemplateColumns гарантирует, что
                колонки во всех трёх рядах (суммы/график/дни недели) сидят
                РОВНО на одних и тех же границах. С flex-1 колонка с текстом,
                который не помещается в CHART_COLUMN_MIN_WIDTH, растягивалась
                шире соседних (браузер не сжимает flex-item ниже контента без
                overflow-hidden — тот же трюк не до конца спасал), и сетка
                этого ряда расходилась с сеткой графика ниже — то самое
                смещение подписей в "Месяц", что нашёл пользователь
                2026-07-16 ("значения вершин так и остались где-то далеко").
                Grid считает треки один раз для всех ячеек, а не независимо
                на каждый ряд — расхождению просто неоткуда взяться. */}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${data.bars.length}, minmax(${CHART_COLUMN_MIN_WIDTH}px, 1fr))` }}
            >
              {/* Суммы Выручки и Прибыли рядом друг с другом, каждая своим
                  цветом (запрос пользователя 2026-07-16: "надо отображать
                  суммы прибыли, как и выручки, рядом"). */}
              {data.bars.map((b) => (
                <div key={`values-${b.date}`} className="overflow-hidden text-center text-[0.5rem] font-bold tabular-nums">
                  {b.total > 0 && <div className="truncate text-primary">{formatMoneyCompact(b.total, locale, t.reports.compactThousandSuffix, t.reports.compactMillionSuffix)}</div>}
                  {b.profit !== 0 && <div className="truncate text-success">{formatMoneyCompact(b.profit, locale, t.reports.compactThousandSuffix, t.reports.compactMillionSuffix)}</div>}
                </div>
              ))}
              {/* Только две линии тренда + точки на вершинах, без столбцов
                  (запрос пользователя 2026-07-16: "какие-то бары появились,
                  они не нужны" — с двумя цветными линиями столбцы читались
                  как лишний слой). Маркеры — обычные div'ы поверх svg, не
                  svg-circle: при preserveAspectRatio="none" (разный масштаб
                  по x/y) svg-круг растянулся бы в эллипс. Без tooltip'ов
                  (запрос пользователя 2026-07-16: "убери все тултипы везде в
                  этих графиках") — только статичные подписи выше/ниже. */}
              <div className="relative col-span-full" style={{ height: 70 }}>
                {data.bars.length > 1 && (
                  <svg
                    className="pointer-events-none absolute inset-0 size-full overflow-visible"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <polyline
                      points={data.bars.map((b, i) => `${((i + 0.5) / data.bars.length) * 100},${yFor(b.total)}`).join(" ")}
                      fill="none"
                      className="text-primary"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      points={data.bars.map((b, i) => `${((i + 0.5) / data.bars.length) * 100},${yFor(b.profit)}`).join(" ")}
                      fill="none"
                      className="text-success"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                {data.bars.map((b, i) => {
                  const x = ((i + 0.5) / data.bars.length) * 100;
                  return (
                    <div key={`markers-${b.date}`} className="pointer-events-none absolute inset-0 size-full">
                      <div
                        className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
                        style={{ left: `${x}%`, top: `${yFor(b.total)}%` }}
                      />
                      <div
                        className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-success ring-2 ring-card"
                        style={{ left: `${x}%`, top: `${yFor(b.profit)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              {data.bars.map((b) => (
                <div key={`weekday-${b.date}`} className="overflow-hidden truncate text-center text-[0.625rem] font-semibold text-muted-foreground">
                  {new Date(b.date).toLocaleDateString(
                    undefined,
                    data.period.granularity === "year" ? { month: "short" } : { weekday: "short" }
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3.5 grid grid-cols-3 gap-3 border-t border-border pt-3.5 tabular-nums">
          <div>
            <div className="text-caption-airbnb">{t.reports.cashLabel}</div>
            <div className="text-[1rem] font-bold"><Money value={data.cash} /></div>
          </div>
          <div>
            <div className="text-caption-airbnb">{t.reports.mobileLabel}</div>
            <div className="text-[1rem] font-bold"><Money value={data.mobile} /></div>
          </div>
          <div>
            <div className="text-caption-airbnb">{t.reports.submissionsLabel}</div>
            <div className="text-[1rem] font-bold">{data.submissionsCount}</div>
          </div>
        </div>
      </SpringCard>

      <SpringCard animate={false} hover={false}>
        <div className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
          {t.reports.plTitle}
        </div>
        <div className="flex flex-col tabular-nums">
          <div className="flex justify-between py-2 text-body-airbnb">
            <span className="text-muted-foreground">{t.reports.revenueLabel}</span>
            <span className="font-semibold"><Money value={data.profitAndLoss.revenue} /></span>
          </div>
          <div className="flex justify-between py-2 text-body-airbnb">
            <span className="text-muted-foreground">− {t.reports.expensesLabel}</span>
            <span className="font-semibold"><Money value={data.profitAndLoss.expenses} /></span>
          </div>
          <div className="flex justify-between py-2 text-body-airbnb">
            <span className="text-muted-foreground">− {t.reports.payoutsLabel}</span>
            <span className="font-semibold"><Money value={data.profitAndLoss.payouts} /></span>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-body-airbnb">
            <span className="font-bold">= {t.reports.profitLabel}</span>
            <span className="text-[0.9375rem] font-extrabold text-primary"><Money value={data.profitAndLoss.profit} /></span>
          </div>
        </div>
      </SpringCard>
    </div>
  );
}

function RankBar({ label, total, sharePercent, suffix }: { label: string; total: number; sharePercent: number; suffix?: string }) {
  return (
    <div className="mb-1">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-body-airbnb font-semibold">{label}</span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span className="min-w-[4.5rem] text-right text-body-airbnb font-bold tabular-nums">
            <Money value={total} />
          </span>
          <span className="min-w-[2.75rem] text-right text-caption-airbnb tabular-nums">
            {suffix ?? `${sharePercent}%`}
          </span>
        </span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, sharePercent)}%` }} />
      </div>
    </div>
  );
}

// Точная сумма по тапу на ячейку теплокарты (запрос пользователя 2026-07-16) —
// в самой ячейке текст сокращён/подогнан под размер экрана и может быть
// неточным ("2.7к"), тултип поверх ячейки всегда показывает копейка в
// копейку, крупным текстом (фидбек: "значительно крупнее" — мелкая подпись
// была не заметна). Две строки: смайлик по уровню сверху, точная сумма
// снизу. Сам гаснет через 2с (setTimeout у вызывающего компонента) —
// fade-out, не резкое исчезновение, отсюда AnimatePresence. Клик вне ячеек
// (invisible overlay) закрывает раньше.
// 3 уровня (запрос пользователя 2026-07-16: "по факту три фазы смайлов,
// широкую улыбку не надо") — общие для цвета ячейки и для смайлика в
// тултипе. Нормализация — позиция значения МЕЖДУ реальными min и max
// введённых сумм (только ячейки с hasData && total>0), а не value/maxVal
// сетки: раньше вторник (2700, максимум) и среда (2300, ~85% от максимума)
// оба попадали в верхний уровень и красились одинаково, хотя среда явно
// "хуже" вторника при текущих данных. Так самый слабый из уже сданных дней
// всегда внизу шкалы, самый сильный — наверху, а по мере появления новых
// дней шкала естественно пересчитывается (тот же принцип, что и у любой
// относительной тепловой карты).
function moodLevel(ratio: number): 0 | 1 | 2 {
  if (ratio < 1 / 3) return 0;
  if (ratio < 2 / 3) return 1;
  return 2;
}

function normalizedRatio(value: number, minVal: number, maxVal: number) {
  return maxVal > minVal ? (value - minVal) / (maxVal - minVal) : 1;
}

// Заливка ячейки — непрерывная функция ratio, НЕ через 3-уровневый
// moodLevel (тот остаётся дискретным только для смайлика в тултипе, у
// эмоции и должно быть всего 3 фазы — запрос пользователя 2026-07-16). Баг
// найден пользователем 2026-07-17: среда (2300, ~85% диапазона между
// реальными min/max) и вторник (2700, максимум) оба попадали в верхнюю
// треть уровней moodLevel и красились одинаковым сплошным цветом, хотя
// среда явно слабее — по ratio ячейка должна быть "серединкой" между ними,
// а с 3 бакетами такого разрешения физически нет.
function cellOpacity(ratio: number) {
  return 0.35 + ratio * 0.65;
}

function CellTooltip({ value, minVal, maxVal }: { value: number; minVal: number; maxVal: number }) {
  const level = moodLevel(normalizedRatio(value, minVal, maxVal));
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // Всегда сплошной акцентный цвет (запрос пользователя 2026-07-16:
      // "прозрачность ячейки не должна влиять на прозрачность tooltip") —
      // никакой связи с CELL_OPACITY ячейки, только сам уровень смайлика.
      className="absolute bottom-full left-1/2 z-50 mb-2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap rounded-control bg-primary px-3.5 py-2 text-lg font-bold text-primary-foreground shadow-lg"
    >
      {level === 0 ? <Frown className="size-5" /> : level === 1 ? <Meh className="size-5" /> : <Smile className="size-5" />}
      <Money value={value} />
      <span className="absolute left-1/2 top-full -translate-x-1/2 border-[6px] border-transparent border-t-primary" />
    </motion.div>
  );
}

function Insight({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "good" }) {
  const Icon = tone === "good" ? Lightbulb : AlertTriangle;
  return (
    <div
      className={cn(
        "mb-3 flex items-start gap-2.5 rounded-control p-3 text-sm leading-relaxed",
        tone === "good" ? "bg-primary/10 text-primary" : "bg-warning/15 text-warning"
      )}
    >
      <Icon className="size-4 shrink-0 translate-y-0.5" />
      <span>{children}</span>
    </div>
  );
}

function ZonesTab({
  data,
  t,
  onDrillZoneChange,
}: {
  data: ZonesData;
  t: ReturnType<typeof useI18n>;
  onDrillZoneChange: (zoneId: string) => void;
}) {
  if (data.zoneRanking.length === 0) {
    return <p className="text-body-airbnb text-muted-foreground">{t.reports.noZones}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <SpringCard animate={false} hover={false}>
        <div className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
          {t.reports.revenueByZoneTitle}
        </div>
        {data.zoneRanking.map((z) => (
          <RankBar key={z.zoneId} label={z.zoneName} total={z.total} sharePercent={z.sharePercent} />
        ))}
      </SpringCard>

      {data.drillZoneId && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-caption-airbnb">{t.reports.assetsTitle}</span>
            <Select
              value={data.drillZoneId}
              onValueChange={(v) => v && onDrillZoneChange(v)}
              items={data.zoneRanking.map((z) => ({ value: z.zoneId, label: z.zoneName }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    {(() => {
                      const current = data.zoneRanking.find((z) => z.zoneId === data.drillZoneId);
                      return current?.iconKey ? (
                        <AssetOrZoneIcon iconKey={current.iconKey} className="size-6 shrink-0" />
                      ) : (
                        <MapPin className="size-6 shrink-0 text-muted-foreground" />
                      );
                    })()}
                    {data.drillZoneName}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {data.zoneRanking.map((z) => (
                  <SelectItem key={z.zoneId} value={z.zoneId}>
                    <span className="flex items-center gap-2">
                      {z.iconKey ? (
                        <AssetOrZoneIcon iconKey={z.iconKey} className="size-6 shrink-0" />
                      ) : (
                        <MapPin className="size-6 shrink-0 text-muted-foreground" />
                      )}
                      {z.zoneName}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {data.insight && (
            <Insight>
              {t.reports.lowAssetSharePrefix} «{data.insight.assetName}» {t.reports.lowAssetShareMiddle}{" "}
              {data.insight.sharePercent}% {t.reports.lowAssetShareExpectedSuffix} {data.insight.expectedSharePercent}%.
            </Insight>
          )}

          {data.assetRanking.length > 0 && (
            <SpringCard animate={false} hover={false}>
              {data.assetRanking.map((a) => (
                <RankBar key={a.assetId} label={a.assetName} total={a.total} sharePercent={a.sharePercent} />
              ))}
            </SpringCard>
          )}

          {data.tariffBreakdown.length > 0 && (
            <SpringCard animate={false} hover={false}>
              <div className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
                {t.reports.tariffsTitle}
              </div>
              {data.tariffBreakdown.map((tr) => (
                <RankBar key={tr.tariffId} label={tr.tariffName} total={tr.total} sharePercent={tr.sharePercent} />
              ))}
            </SpringCard>
          )}
        </>
      )}
    </div>
  );
}

function OperatorsTab({ operators, t }: { operators: OperatorRow[]; t: ReturnType<typeof useI18n> }) {
  if (operators.length === 0) {
    return <p className="text-body-airbnb text-muted-foreground">{t.reports.noOperators}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {operators.map((op) => (
        <SpringCard key={op.operatorId} animate={false} hover={false}>
          <div className="mb-3 flex items-center gap-3">
            <div className="relative shrink-0">
              {op.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={op.avatarUrl} alt="" className="size-11 rounded-full object-cover" />
              ) : op.iconKey ? (
                <div className="flex size-11 items-center justify-center rounded-full bg-primary/10">
                  <AssetOrZoneIcon iconKey={op.iconKey} className="size-9" />
                </div>
              ) : (
                <div className="flex size-11 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                  {op.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              {op.colorTag && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-card"
                  style={{ backgroundColor: op.colorTag }}
                />
              )}
            </div>
            <div className="min-w-0 grow">
              <div className="text-card-title">{op.name}</div>
              <div className="text-caption-airbnb">
                {op.shiftsCount} {t.reports.shiftsSuffix} · {op.totalHours} {t.reports.hoursSuffix}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 tabular-nums">
            <div>
              <div className="text-caption-airbnb">{t.reports.revenuePerHourLabel}</div>
              <div className="text-[1rem] font-bold">
                {op.revenuePerHour !== null ? <Money value={op.revenuePerHour} /> : "—"}
              </div>
            </div>
            <div>
              <div className="text-caption-airbnb">{t.reports.accruedLabel}</div>
              <div className="text-[1rem] font-bold"><Money value={op.accruedForPeriod} /></div>
            </div>
            <div>
              <div className="text-caption-airbnb">{t.reports.differenceLabel}</div>
              <div className={cn("text-[1rem] font-bold", op.differenceSum >= 0 ? "text-primary" : "text-destructive")}>
                {op.differenceSum > 0 ? "+" : ""}
                <Money value={op.differenceSum} />
              </div>
            </div>
          </div>
          {op.hasNegativeStreak && <Insight>{t.reports.negativeStreakLabel}</Insight>}
        </SpringCard>
      ))}
    </div>
  );
}

function CalendarTab({ data, t }: { data: CalendarData; t: ReturnType<typeof useI18n> }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function openTooltip(date: string) {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    if (activeDate === date) {
      setActiveDate(null);
      return;
    }
    setActiveDate(date);
    tooltipTimeoutRef.current = setTimeout(() => setActiveDate(null), 2000);
  }
  if (data.months !== null) {
    return <CalendarMonthsTab months={data.months} t={t} />;
  }

  const presentValues = data.weeks.flatMap((w) => w.days.filter((d) => d.hasData && d.total > 0).map((d) => d.total));
  const maxVal = presentValues.length ? Math.max(...presentValues) : 1;
  const minVal = presentValues.length ? Math.min(...presentValues) : 0;
  return (
    <div className="flex flex-col gap-3">
      {activeDate && <div className="fixed inset-0 z-30" onClick={() => setActiveDate(null)} />}
      <SpringCard animate={false} hover={false}>
        <div className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
          {t.reports.revenueByWeekdayTitle} · {data.weeks.length} {t.reports.weeksSuffix}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {t.readings.weekdays.map((label) => (
            <div key={label} className="text-center text-[0.65625rem] font-semibold text-muted-foreground">
              {label}
            </div>
          ))}
        </div>
        {data.weeks.map((w) => (
          <div key={w.weekStart} className="mt-1.5 grid grid-cols-7 gap-1.5">
            {w.days.map((d) => (
              <div
                key={d.date}
                className={cn(
                  "relative z-40 flex aspect-square items-center justify-center rounded-lg text-[clamp(0.5rem,2.6vw,0.75rem)] font-bold text-white",
                  (!d.hasData || d.total === 0) && "bg-muted text-muted-foreground"
                )}
                onClick={() => d.total > 0 && openTooltip(d.date)}
              >
                {/* Заливка — отдельный слой под текстом/tooltip (не opacity
                    самой ячейки): opacity композитит весь поддерево включая
                    детей, и tooltip-потомок "наследовал" бы прозрачность
                    ячейки (нашёл пользователь 2026-07-16). */}
                {d.hasData && d.total > 0 && (
                  <div
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background: "var(--color-primary)",
                      opacity: cellOpacity(normalizedRatio(d.total, minVal, maxVal)),
                    }}
                  />
                )}
                <span className="relative">{d.total > 0 ? Math.round(d.total / 100) / 10 + "к" : ""}</span>
                <AnimatePresence>
                  {activeDate === d.date && <CellTooltip value={d.total} minVal={minVal} maxVal={maxVal} />}
                </AnimatePresence>
              </div>
            ))}
          </div>
        ))}
        <div className="mt-3 flex items-center gap-1.5 text-caption-airbnb">
          <span>{t.reports.legendLess}</span>
          <span className="size-3.5 rounded bg-muted" />
          <span className="size-3.5 rounded bg-primary/40" />
          <span className="size-3.5 rounded bg-primary/70" />
          <span className="size-3.5 rounded bg-primary" />
          <span>{t.reports.legendMore}</span>
        </div>
      </SpringCard>
    </div>
  );
}

// "Год" — 12 месяцев вместо сетки дней недели: 52 строки нечитаемы на
// телефоне, сезонность за год показательнее по месяцам (запрос пользователя
// 2026-07-15).
function CalendarMonthsTab({
  months,
  t,
}: {
  months: { month: number; total: number; hasData: boolean }[];
  t: ReturnType<typeof useI18n>;
}) {
  const presentMonthValues = months.filter((mo) => mo.hasData && mo.total > 0).map((mo) => mo.total);
  const maxVal = presentMonthValues.length ? Math.max(...presentMonthValues) : 1;
  const minVal = presentMonthValues.length ? Math.min(...presentMonthValues) : 0;
  const locale = useLocale();
  const sign = getCurrencySign(useCurrency());
  const [activeMonth, setActiveMonth] = useState<number | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function openTooltip(month: number) {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    if (activeMonth === month) {
      setActiveMonth(null);
      return;
    }
    setActiveMonth(month);
    tooltipTimeoutRef.current = setTimeout(() => setActiveMonth(null), 2000);
  }
  return (
    <div className="flex flex-col gap-3">
      {activeMonth !== null && <div className="fixed inset-0 z-30" onClick={() => setActiveMonth(null)} />}
      <SpringCard animate={false} hover={false}>
        <div className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
          {t.reports.revenueByMonthTitle}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {months.map((mo) => (
            <div
              key={mo.month}
              className={cn(
                "relative z-40 flex h-16 flex-col items-center justify-center gap-1 rounded-lg p-1 text-center font-bold text-white",
                (!mo.hasData || mo.total === 0) && "bg-muted text-muted-foreground"
              )}
              onClick={() => mo.total > 0 && openTooltip(mo.month)}
            >
              {/* Заливка — отдельный слой под текстом/tooltip, см. тот же
                  приём и комментарий в CalendarTab выше. */}
              {mo.hasData && mo.total > 0 && (
                <div
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: "var(--color-primary)",
                    opacity: cellOpacity(normalizedRatio(mo.total, minVal, maxVal)),
                  }}
                />
              )}
              <span className="relative text-[0.6875rem] leading-tight font-semibold">{t.readings.months[mo.month]}</span>
              <span className="relative text-[clamp(0.5625rem,3.2vw,0.8125rem)] leading-tight tabular-nums">
                {mo.total > 0 ? (
                  mo.total < 100_000 ? (
                    <Money value={mo.total} />
                  ) : (
                    <>
                      {formatMoneyCompact(mo.total, locale, t.reports.compactThousandSuffix, t.reports.compactMillionSuffix)}
                      {sign && <span className="ml-[0.12em] text-[0.7em] opacity-70">{sign}</span>}
                    </>
                  )
                ) : (
                  ""
                )}
              </span>
              <AnimatePresence>
                {activeMonth === mo.month && <CellTooltip value={mo.total} minVal={minVal} maxVal={maxVal} />}
              </AnimatePresence>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-caption-airbnb">
          <span>{t.reports.legendLess}</span>
          <span className="size-3.5 rounded bg-muted" />
          <span className="size-3.5 rounded bg-primary/40" />
          <span className="size-3.5 rounded bg-primary/70" />
          <span className="size-3.5 rounded bg-primary" />
          <span>{t.reports.legendMore}</span>
        </div>
      </SpringCard>
    </div>
  );
}
