"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Switch } from "@/components/ui/switch";
import { TelegramPreviewBubble } from "@/components/telegram-preview-bubble";
import { useI18n, useLocale } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { formatZoneSummaryTelegram } from "@/lib/summary-channels/telegram-format";
import type { ZoneSummaryData } from "@/lib/summary-channels/types";
import { ZONE_SUMMARY_DEFAULTS, type ZoneSummarySettingsData } from "@/lib/summary-settings";
import type { ZoneAccountingMode } from "@/lib/results-calc";
import type { SummaryPreviewContext } from "@/lib/summary-preview-context";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Реальные зоны тенанта бывают разных режимов учёта, а сводка выглядит для
// каждого режима по-разному (formatZoneSummaryTelegram ветвится по
// accountingMode/isGameRoom) — один статичный предпросмотр не показывал, как
// будет выглядеть сводка для остальных режимов (запрос пользователя
// 2026-07-19: "предпросмотр надо сделать несколько в зависимости от режима
// учёта, меняется свайпом"). Порядок — от самого частого к самому редкому.
const PREVIEW_MODES: ZoneAccountingMode[] = ["counters", "launches", "stays", "cash_only", "tickets"];

// Числа в предпросмотре — демо (тумблеры проверяют, ЧТО показывается, не
// сколько), а названия зоны/активов/тарифов/оператора — настоящие (см. фидбек
// пользователя: предпросмотр должен отражать реальный чат). Источник —
// GET /api/tenant/summary-settings/preview-context.
const SAMPLE_READING_NUMBERS = [
  { reading: 3132, delta: 15 },
  { reading: 429, delta: 3 },
  { reading: 8162, delta: 12 },
  { reading: 1724, delta: 9 },
];

// Реальный контекст — отдельно на каждый режим учёта (ctx.byMode, запрос
// пользователя 2026-07-19: "у нас есть тестовая точка с такими зонами и
// сотрудник Катя" — раньше API отдавал только ОДНУ, самую старую зону
// тенанта любого режима, поэтому вкладки остальных режимов показывали
// плейсхолдер "Зона не создана", даже когда реальная зона этого режима
// существовала). Оператор — общий, не зонозависимый.
// Демо-разбивка по активам для "Прибываний"/"Пусков" — реальные названия из
// modeCtx.assetNames, если они есть, иначе те же плейсхолдеры, что и у
// "Счётчиков" (t.summaries.previewNoAsset). Веса убывающие (первый актив
// "самый занятый") — просто чтобы строки не выглядели одинаково скучно, точная
// пропорция здесь не принципиальна (цифры и так демо).
function splitPerAsset(names: string[], totalCount: number, totalAmount: number) {
  if (names.length === 0) return [];
  const weights = names.map((_, i) => names.length - i);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  return names.map((assetName, i) => ({
    assetName,
    count: Math.max(1, Math.round((totalCount * weights[i]) / weightSum)),
    amount: Math.round(((totalAmount * weights[i]) / weightSum) * 100) / 100,
  }));
}

function buildPreviewData(ctx: SummaryPreviewContext | null, t: Dictionary, mode: ZoneAccountingMode): ZoneSummaryData {
  const modeCtx = ctx?.byMode[mode];
  const base = {
    pointName: modeCtx?.pointName ?? t.summaries.previewNoPoint,
    zoneName: modeCtx?.zoneName ?? t.summaries.previewNoZone,
    zoneEmoji: modeCtx?.zoneEmoji ?? null,
    occurredAt: new Date(Date.UTC(2026, 6, 8, 22, 0)),
    operatorName: modeCtx?.operatorName ?? t.summaries.previewNoOperator,
    operatorColorTag: modeCtx?.operatorColorTag ?? null,
  };

  if (mode === "cash_only") {
    return {
      ...base,
      accountingMode: "cash_only",
      isGameRoom: false,
      gameRoomLaunchCount: null,
      gameRoomTotalMinutes: null,
      readings: [],
      perAsset: [],
      ticketsOrdersCount: null,
      ticketsCount: null,
      cashAmount: 1345,
      mobileAmount: 0,
      abonementAmount: 0,
      calculatedRevenue: 0,
      difference: 0,
      returnsCount: 0,
    };
  }

  if (mode === "tickets") {
    return {
      ...base,
      accountingMode: "tickets",
      isGameRoom: false,
      gameRoomLaunchCount: null,
      gameRoomTotalMinutes: null,
      readings: [],
      perAsset: [],
      ticketsOrdersCount: 14,
      ticketsCount: 22,
      cashAmount: 900,
      mobileAmount: 200,
      abonementAmount: 100,
      calculatedRevenue: 1200,
      difference: Math.round((900 + 200 - 1200) * 100) / 100,
      returnsCount: 0,
    };
  }

  if (mode === "stays") {
    const names = modeCtx && modeCtx.assetNames.length > 0 ? modeCtx.assetNames.slice(0, 3) : [t.summaries.previewNoAsset];
    return {
      ...base,
      accountingMode: "stays",
      isGameRoom: true,
      gameRoomLaunchCount: 18,
      gameRoomTotalMinutes: 245,
      readings: [],
      perAsset: splitPerAsset(names, 18, 1715),
      ticketsOrdersCount: null,
      ticketsCount: null,
      cashAmount: 1200,
      mobileAmount: 300,
      abonementAmount: 150,
      calculatedRevenue: 1715,
      difference: Math.round((1200 + 300 - 1715) * 100) / 100,
      returnsCount: 1,
    };
  }

  if (mode === "launches") {
    const names = modeCtx && modeCtx.assetNames.length > 0 ? modeCtx.assetNames.slice(0, 3) : [t.summaries.previewNoAsset];
    return {
      ...base,
      accountingMode: "launches",
      isGameRoom: false,
      gameRoomLaunchCount: 24,
      gameRoomTotalMinutes: null,
      readings: [],
      perAsset: splitPerAsset(names, 24, 1200),
      ticketsOrdersCount: null,
      ticketsCount: null,
      cashAmount: 1000,
      mobileAmount: 200,
      abonementAmount: 0,
      calculatedRevenue: 1200,
      difference: Math.round((1000 + 200 - 1200) * 100) / 100,
      returnsCount: 0,
    };
  }

  // counters
  const pairs =
    modeCtx && modeCtx.readingPairs.length > 0
      ? modeCtx.readingPairs
      : [
          { assetName: t.summaries.previewNoAsset, tariffName: t.summaries.previewNoTariff },
          { assetName: t.summaries.previewNoAsset, tariffName: t.summaries.previewNoTariff },
        ];
  const readings = pairs.slice(0, 4).map((p, i) => ({ ...p, ...SAMPLE_READING_NUMBERS[i] }));

  return {
    ...base,
    accountingMode: "counters",
    isGameRoom: false,
    gameRoomLaunchCount: null,
    gameRoomTotalMinutes: null,
    readings,
    perAsset: [],
    ticketsOrdersCount: null,
    ticketsCount: null,
    // Демо-цифры согласованы с реальной формулой (submit-results/route.ts:
    // difference = (cashAmount + mobileAmount) - calculatedRevenue) — раньше
    // difference было отдельным произвольным числом (25), не совпадавшим с
    // Касс/Счёт на экране, пользователь справедливо принял это за опечатку
    // ("Касса 1345, по счётчикам 1715 — разница должна быть -370"). mobileAmount
    // здесь 0 (не 370, как раньше) — иначе строка "Касс" в компактном виде
    // (Нал.+Безнал вместе, см. telegram-format.ts) не совпала бы с "1345" из
    // примера пользователя.
    cashAmount: 1345,
    mobileAmount: 0,
    abonementAmount: 0,
    calculatedRevenue: 1715,
    difference: 1345 + 0 - 1715,
    returnsCount: 0,
  };
}

export default function ZoneSummaryEditorPage() {
  const router = useRouter();
  const t = useI18n();
  const locale = useLocale();
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState<ZoneSummarySettingsData>(ZONE_SUMMARY_DEFAULTS);
  const [previewContext, setPreviewContext] = useState<SummaryPreviewContext | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/tenant/summary-settings/zone"),
      fetch("/api/tenant/summary-settings/preview-context"),
    ]).then(async ([settingsRes, ctxRes]) => {
      if (settingsRes.status === 401) {
        router.replace("/login");
        return;
      }
      setSettings(await settingsRes.json());
      setPreviewContext(await ctxRes.json());
      setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(partial: Partial<ZoneSummarySettingsData>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    fetch("/api/tenant/summary-settings/zone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  const previewMode = PREVIEW_MODES[previewIndex];
  const previewText = useMemo(
    () =>
      formatZoneSummaryTelegram(
        buildPreviewData(previewContext, t, previewMode),
        settings,
        locale,
        previewContext?.timezone ?? "UTC",
        t.summaryText
      ),
    [settings, previewContext, t, locale, previewMode]
  );

  const modeLabels: Record<ZoneAccountingMode, string> = {
    counters: t.zonesList.accountingModeCounters,
    launches: t.zonesList.accountingModeLaunches,
    stays: t.zonesList.accountingModeStays,
    cash_only: t.zonesList.accountingModeCashOnly,
    tickets: t.zonesList.accountingModeTickets,
  };

  const rows: Array<{
    key: keyof ZoneSummarySettingsData;
    label: string;
    sub: string;
  }> = [
    { key: "showReadings", label: t.summaries.zoneShowReadingsLabel, sub: t.summaries.zoneShowReadingsSub },
    { key: "showDelta", label: t.summaries.zoneShowDeltaLabel, sub: t.summaries.zoneShowDeltaSub },
    { key: "showCash", label: t.summaries.zoneShowCashLabel, sub: t.summaries.zoneShowCashSub },
    { key: "showCalc", label: t.summaries.zoneShowCalcLabel, sub: t.summaries.zoneShowCalcSub },
    { key: "showDiff", label: t.summaries.zoneShowDiffLabel, sub: t.summaries.zoneShowDiffSub },
    { key: "showReturns", label: t.summaries.zoneShowReturnsLabel, sub: t.summaries.zoneShowReturnsSub },
    { key: "showOperator", label: t.summaries.zoneShowOperatorLabel, sub: t.summaries.zoneShowOperatorSub },
    { key: "compact", label: t.summaries.zoneCompactLabel, sub: t.summaries.zoneCompactSub },
  ];

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-1">
          <Link href="/settings/summaries" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.summaries.listTitle}
          </Link>
          <h1 className="text-screen-title">{t.summaries.zoneEditorTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.zoneEditorSub}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-1 text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.compositionCardLabel}
                </span>
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
                    <div className="min-w-0">
                      <div className="text-body-airbnb">{row.label}</div>
                      <div className="text-caption-airbnb">{row.sub}</div>
                    </div>
                    <Switch
                      checked={settings[row.key] as boolean}
                      onCheckedChange={(v) => patch({ [row.key]: v })}
                      className="shrink-0"
                    />
                  </div>
                ))}
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-3 text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.previewCardLabel}
                </span>
                {/* Свайп влево/вправо между режимами учёта (запрос
                    пользователя 2026-07-19) — у каждого своя вёрстка сводки
                    (formatZoneSummaryTelegram ветвится по accountingMode/
                    isGameRoom), один статичный пример не показывал остальные.
                    key на mode пересоздаёт drag-узел при переключении через
                    точки — иначе framer-motion сохранял бы смещение
                    предыдущего свайпа на новом контенте. */}
                <motion.div
                  key={previewMode}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.15}
                  onDragEnd={(_, info) => {
                    const threshold = 60;
                    if (info.offset.x < -threshold && previewIndex < PREVIEW_MODES.length - 1) {
                      setPreviewIndex(previewIndex + 1);
                    } else if (info.offset.x > threshold && previewIndex > 0) {
                      setPreviewIndex(previewIndex - 1);
                    }
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                >
                  <TelegramPreviewBubble text={previewText} time="22:00" />
                </motion.div>
                <div className="mt-3 flex items-center justify-center gap-2">
                  {PREVIEW_MODES.map((mode, i) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPreviewIndex(i)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors",
                        i === previewIndex ? "bg-primary/10 text-primary" : "text-muted-foreground"
                      )}
                    >
                      {modeLabels[mode]}
                    </button>
                  ))}
                </div>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
