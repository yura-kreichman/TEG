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
  Laugh,
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
  bars: { date: string; total: number }[];
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
        <div className="flex w-full max-w-2xl flex-col gap-1">
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
  if (percent === null) {
    return <span className="text-caption-airbnb text-muted-foreground">{t.reports.noPreviousPeriodData}</span>;
  }
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

function DynamicsTab({ data, t }: { data: DynamicsData; t: ReturnType<typeof useI18n> }) {
  const maxBar = Math.max(1, ...data.bars.map((b) => b.total));
  if (data.submissionsCount === 0) {
    return <p className="text-body-airbnb text-muted-foreground">{t.reports.noDataForPeriod}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <SpringCard animate={false}>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[2rem] font-extrabold tracking-[-0.02em] tabular-nums">
            <Money value={data.total} size="display" />
          </span>
          <Delta percent={data.deltaPercent} t={t} />
        </div>
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex gap-1.5">
            {data.bars.map((b) => (
              <div key={b.date} className="flex-1 text-center text-[0.5625rem] font-bold text-muted-foreground tabular-nums">
                {b.total > 0 ? <Money value={b.total} /> : ""}
              </div>
            ))}
          </div>
          {/* Столбцы + линия тренда поверх (запрос пользователя 2026-07-16:
              "не видно графика, ходящего между двумя точками" — раньше была
              только столбчатая диаграмма без соединяющей линии). Точки линии
              считаются в процентах общей высоты этого ряда (viewBox 0..100),
              как и высота самих столбцов — единая система координат для
              обоих, растягивается вместе с контейнером без пересчёта в JS. */}
          <div className="relative flex h-[70px] items-end gap-1.5">
            {data.bars.map((b) => (
              <div key={b.date} className="flex flex-1 items-end">
                <div
                  className="w-full rounded-t-md bg-primary/80"
                  style={{ height: `${Math.max(4, (b.total / maxBar) * 100)}%` }}
                />
              </div>
            ))}
            {data.bars.length > 1 && (
              <svg
                className="pointer-events-none absolute inset-0 size-full overflow-visible text-primary"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polyline
                  points={data.bars
                    .map((b, i) => {
                      const x = ((i + 0.5) / data.bars.length) * 100;
                      const y = 100 - Math.max(4, (b.total / maxBar) * 100);
                      return `${x},${y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
          <div className="flex gap-1.5">
            {data.bars.map((b) => (
              <div key={b.date} className="flex-1 text-center text-[0.625rem] font-semibold text-muted-foreground">
                {new Date(b.date).toLocaleDateString(
                  undefined,
                  data.period.granularity === "year" ? { month: "short" } : { weekday: "short" }
                )}
              </div>
            ))}
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

      <SpringCard animate={false}>
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
// 4 уровня — общие для цвета ячейки и для смайлика в тултипе. Раньше цвет
// был непрерывным градиентом (opacity плавно от 0.25 до 1), а смайлик грубым
// квартилем ratio<0.25/0.5/0.75 — из-за этого у двух заметно разных по цвету
// ячеек мог оказаться один и тот же смайлик (нашёл пользователь 2026-07-16:
// "они разного цвета, а почему смайлик одинаковый?"). Теперь оба берут один
// и тот же moodLevel на тех же порогах, глазами это ровно 4 ступени.
function moodLevel(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio < 0.25) return 0;
  if (ratio < 0.5) return 1;
  if (ratio < 0.75) return 2;
  return 3;
}
const CELL_OPACITY: Record<0 | 1 | 2 | 3, number> = { 0: 0.35, 1: 0.55, 2: 0.8, 3: 1 };

function CellTooltip({ value, maxVal }: { value: number; maxVal: number }) {
  const level = moodLevel(maxVal > 0 ? value / maxVal : 0);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap rounded-control bg-foreground px-3.5 py-2 text-lg font-bold text-background shadow-lg"
    >
      {level === 0 ? (
        <Frown className="size-5" />
      ) : level === 1 ? (
        <Meh className="size-5" />
      ) : level === 2 ? (
        <Smile className="size-5" />
      ) : (
        <Laugh className="size-5" />
      )}
      <Money value={value} />
      <span className="absolute left-1/2 top-full -translate-x-1/2 border-[6px] border-transparent border-t-foreground" />
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
      <SpringCard animate={false}>
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
            <SpringCard animate={false}>
              {data.assetRanking.map((a) => (
                <RankBar key={a.assetId} label={a.assetName} total={a.total} sharePercent={a.sharePercent} />
              ))}
            </SpringCard>
          )}

          {data.tariffBreakdown.length > 0 && (
            <SpringCard animate={false}>
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
        <SpringCard key={op.operatorId} animate={false}>
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

  const maxVal = Math.max(1, ...data.weeks.flatMap((w) => w.days.map((d) => d.total)));
  return (
    <div className="flex flex-col gap-3">
      {activeDate && <div className="fixed inset-0 z-30" onClick={() => setActiveDate(null)} />}
      <SpringCard animate={false}>
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
                style={
                  d.hasData && d.total > 0
                    ? { background: "var(--color-primary)", opacity: CELL_OPACITY[moodLevel(d.total / maxVal)] }
                    : undefined
                }
                onClick={() => d.total > 0 && openTooltip(d.date)}
              >
                {d.total > 0 ? Math.round(d.total / 100) / 10 + "к" : ""}
                <AnimatePresence>{activeDate === d.date && <CellTooltip value={d.total} maxVal={maxVal} />}</AnimatePresence>
              </div>
            ))}
          </div>
        ))}
        <div className="mt-3 flex items-center gap-1.5 text-caption-airbnb">
          <span>{t.reports.legendLess}</span>
          <span className="size-3.5 rounded bg-muted" />
          <span className="size-3.5 rounded bg-primary/35" />
          <span className="size-3.5 rounded bg-primary/55" />
          <span className="size-3.5 rounded bg-primary/80" />
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
  const maxVal = Math.max(1, ...months.map((mo) => mo.total));
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
      <SpringCard animate={false}>
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
              style={
                mo.hasData && mo.total > 0
                  ? { background: "var(--color-primary)", opacity: CELL_OPACITY[moodLevel(mo.total / maxVal)] }
                  : undefined
              }
              onClick={() => mo.total > 0 && openTooltip(mo.month)}
            >
              <span className="text-[0.6875rem] leading-tight font-semibold">{t.readings.months[mo.month]}</span>
              <span className="text-[clamp(0.5625rem,3.2vw,0.8125rem)] leading-tight tabular-nums">
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
              <AnimatePresence>{activeMonth === mo.month && <CellTooltip value={mo.total} maxVal={maxVal} />}</AnimatePresence>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-caption-airbnb">
          <span>{t.reports.legendLess}</span>
          <span className="size-3.5 rounded bg-muted" />
          <span className="size-3.5 rounded bg-primary/35" />
          <span className="size-3.5 rounded bg-primary/55" />
          <span className="size-3.5 rounded bg-primary/80" />
          <span className="size-3.5 rounded bg-primary" />
          <span>{t.reports.legendMore}</span>
        </div>
      </SpringCard>
    </div>
  );
}
