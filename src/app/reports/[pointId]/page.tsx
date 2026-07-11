"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Lightbulb, MapPin } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

type Tab = "dynamics" | "zones" | "operators" | "calendar";
type Granularity = "week" | "month";

interface DynamicsData {
  pointName: string;
  total: number;
  cash: number;
  mobile: number;
  submissionsCount: number;
  deltaPercent: number | null;
  bars: { date: string; total: number }[];
  profitAndLoss: { revenue: number; expenses: number; payouts: number; profit: number };
}

interface ZonesData {
  zoneRanking: { zoneId: string; zoneName: string; total: number; sharePercent: number }[];
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
  dowAverages: number[];
  weakestDow: number | null;
  strongestDow: number | null;
  overloadedDow: number | null;
  overloadRatio: number | null;
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

  const [dynamics, setDynamics] = useState<DynamicsData | null>(null);
  const [zones, setZones] = useState<ZonesData | null>(null);
  const [operators, setOperators] = useState<OperatorRow[] | null>(null);
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [zoneIdOverride, setZoneIdOverride] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function loadPeriodData() {
    setLoadError(false);
    const zoneParam = zoneIdOverride ? `&zoneId=${zoneIdOverride}` : "";
    const [dynRes, zonesRes, opsRes] = await Promise.all([
      fetch(`/api/points/${pointId}/reports/dynamics?granularity=${granularity}`),
      fetch(`/api/points/${pointId}/reports/zones?granularity=${granularity}${zoneParam}`),
      fetch(`/api/points/${pointId}/reports/operators?granularity=${granularity}`),
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
    setPointName(dynData.pointName);
    setZones(await zonesRes.json());
    const opsData = await opsRes.json();
    setOperators(opsData.operators ?? []);
    setChecking(false);
  }

  async function loadCalendar() {
    const res = await fetch(`/api/points/${pointId}/reports/calendar`);
    if (res.ok) setCalendar(await res.json());
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadPeriodData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, granularity, zoneIdOverride]);

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId]);

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
              <Select value={pointId} onValueChange={(v) => v && router.push(`/reports/${v}`)} items={points.map((p) => ({ value: p.id, label: p.name }))}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {(() => {
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

          <div className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                  tab === tb.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                )}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {tab !== "calendar" && (
            <div className="mb-4 flex gap-1.5">
              {(["week", "month"] as Granularity[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={cn(
                    "flex-1 rounded-control border py-2 text-sm font-semibold",
                    granularity === g
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {g === "week" ? t.reports.periodWeek : t.reports.periodMonth}
                </button>
              ))}
            </div>
          )}

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
          <span className="text-[32px] font-extrabold tracking-[-0.02em] tabular-nums">{data.total}</span>
          <Delta percent={data.deltaPercent} t={t} />
        </div>
        <div className="mt-4 flex h-[110px] items-end gap-1.5">
          {data.bars.map((b) => (
            <div key={b.date} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[9px] font-bold text-muted-foreground tabular-nums">{b.total || ""}</span>
              <div
                className="w-full rounded-t-md bg-primary/80"
                style={{ height: `${Math.max(4, (b.total / maxBar) * 100)}%` }}
              />
              <span className="text-[10px] font-semibold text-muted-foreground">
                {new Date(b.date).toLocaleDateString(undefined, { weekday: "short" })}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3.5 grid grid-cols-3 gap-3 border-t border-border pt-3.5 tabular-nums">
          <div>
            <div className="text-caption-airbnb">{t.reports.cashLabel}</div>
            <div className="text-[16px] font-bold">{data.cash}</div>
          </div>
          <div>
            <div className="text-caption-airbnb">{t.reports.mobileLabel}</div>
            <div className="text-[16px] font-bold">{data.mobile}</div>
          </div>
          <div>
            <div className="text-caption-airbnb">{t.reports.submissionsLabel}</div>
            <div className="text-[16px] font-bold">{data.submissionsCount}</div>
          </div>
        </div>
      </SpringCard>

      <SpringCard animate={false}>
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {t.reports.plTitle}
        </div>
        <div className="flex flex-col tabular-nums">
          <div className="flex justify-between py-2 text-body-airbnb">
            <span className="text-muted-foreground">{t.reports.revenueLabel}</span>
            <span className="font-semibold">{data.profitAndLoss.revenue}</span>
          </div>
          <div className="flex justify-between py-2 text-body-airbnb">
            <span className="text-muted-foreground">− {t.reports.expensesLabel}</span>
            <span className="font-semibold">{data.profitAndLoss.expenses}</span>
          </div>
          <div className="flex justify-between py-2 text-body-airbnb">
            <span className="text-muted-foreground">− {t.reports.payoutsLabel}</span>
            <span className="font-semibold">{data.profitAndLoss.payouts}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-body-airbnb">
            <span className="font-bold">= {t.reports.profitLabel}</span>
            <span className="text-[15px] font-extrabold text-primary">{data.profitAndLoss.profit}</span>
          </div>
        </div>
      </SpringCard>
    </div>
  );
}

function RankBar({ label, total, sharePercent, suffix }: { label: string; total: number; sharePercent: number; suffix?: string }) {
  return (
    <div className="mb-1">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-body-airbnb font-semibold">{label}</span>
        <span className="text-body-airbnb font-bold tabular-nums">
          {total} <span className="text-caption-airbnb">{suffix ?? `${sharePercent}%`}</span>
        </span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, sharePercent)}%` }} />
      </div>
    </div>
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
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {t.reports.revenueByZoneTitle}
        </div>
        {data.zoneRanking.map((z) => (
          <RankBar key={z.zoneId} label={z.zoneName} total={z.total} sharePercent={z.sharePercent} />
        ))}
      </SpringCard>

      {data.drillZoneId && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-caption-airbnb">{t.reports.assetsTitle} ·</span>
            <Select
              value={data.drillZoneId}
              onValueChange={(v) => v && onDrillZoneChange(v)}
              items={data.zoneRanking.map((z) => ({ value: z.zoneId, label: z.zoneName }))}
            >
              <SelectTrigger className="h-8 w-auto border-none bg-transparent p-0 font-semibold">
                <SelectValue />
              </SelectTrigger>
              {/* Триггер здесь — короткая надпись (w-auto), а не полноширинное
                  поле формы, как у остальных Select в приложении: попап,
                  привязанный к --anchor-width, наследовал бы эту узкую ширину
                  и обрезал названия зон длиннее выбранной сейчас. min-w
                  переопределяет это именно для этого вызова. */}
              <SelectContent className="min-w-40">
                {data.zoneRanking.map((z) => (
                  <SelectItem key={z.zoneId} value={z.zoneId}>
                    {z.zoneName}
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
              <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
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
                  <AssetOrZoneIcon iconKey={op.iconKey} className="size-6" />
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
              <div className="text-[16px] font-bold">{op.revenuePerHour ?? "—"}</div>
            </div>
            <div>
              <div className="text-caption-airbnb">{t.reports.accruedLabel}</div>
              <div className="text-[16px] font-bold">{op.accruedForPeriod}</div>
            </div>
            <div>
              <div className="text-caption-airbnb">{t.reports.differenceLabel}</div>
              <div className={cn("text-[16px] font-bold", op.differenceSum >= 0 ? "text-primary" : "text-destructive")}>
                {op.differenceSum >= 0 ? "+" : ""}
                {op.differenceSum}
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
  const maxVal = Math.max(1, ...data.weeks.flatMap((w) => w.days.map((d) => d.total)));
  return (
    <div className="flex flex-col gap-3">
      <SpringCard animate={false}>
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {t.reports.revenueByWeekdayTitle} · {data.weeks.length} {t.reports.weeksSuffix}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {t.readings.weekdays.map((label) => (
            <div key={label} className="text-center text-[10.5px] font-semibold text-muted-foreground">
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
                  "flex aspect-square items-center justify-center rounded-lg text-[9px] font-bold text-white",
                  !d.hasData && "bg-muted text-muted-foreground"
                )}
                style={d.hasData ? { background: "var(--color-primary)", opacity: 0.25 + (d.total / maxVal) * 0.75 } : undefined}
                title={d.date}
              >
                {d.total > 0 ? Math.round(d.total / 100) / 10 + "к" : ""}
              </div>
            ))}
          </div>
        ))}
        <div className="mt-3 flex items-center gap-1.5 text-caption-airbnb">
          <span>{t.reports.legendLess}</span>
          <span className="size-3.5 rounded bg-muted" />
          <span className="size-3.5 rounded bg-primary/30" />
          <span className="size-3.5 rounded bg-primary/60" />
          <span className="size-3.5 rounded bg-primary" />
          <span>{t.reports.legendMore}</span>
        </div>
      </SpringCard>

      {data.weakestDow !== null && (
        <Insight>
          {t.reports.weakestDayLabel}: {t.readings.weekdaysFull[data.weakestDow]} ·{" "}
          {data.dowAverages[data.weakestDow]}
        </Insight>
      )}
      {data.overloadedDow !== null && (
        <Insight tone="good">
          {t.reports.strongestDayLabel}: {t.readings.weekdaysFull[data.overloadedDow]} ·{" "}
          {data.dowAverages[data.overloadedDow]} ({data.overloadRatio}
          {t.reports.overloadSuffix})
        </Insight>
      )}
    </div>
  );
}
