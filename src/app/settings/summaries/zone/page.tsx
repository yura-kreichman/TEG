"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Switch } from "@/components/ui/switch";
import { TelegramPreviewBubble } from "@/components/telegram-preview-bubble";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { formatZoneSummaryTelegram } from "@/lib/summary-channels/telegram-format";
import type { ZoneSummaryData } from "@/lib/summary-channels/types";
import { ZONE_SUMMARY_DEFAULTS, type ZoneSummarySettingsData } from "@/lib/summary-settings";
import { isZoneAccountingMode } from "@/lib/results-calc";
import type { SummaryPreviewContext } from "@/lib/summary-preview-context";
import type { Dictionary } from "@/lib/i18n";

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

function buildPreviewData(ctx: SummaryPreviewContext | null, t: Dictionary): ZoneSummaryData {
  const pairs =
    ctx && ctx.readingPairs.length > 0
      ? ctx.readingPairs
      : [
          { assetName: t.summaries.previewNoAsset, tariffName: t.summaries.previewNoTariff },
          { assetName: t.summaries.previewNoAsset, tariffName: t.summaries.previewNoTariff },
        ];
  const readings = pairs.slice(0, 4).map((p, i) => ({ ...p, ...SAMPLE_READING_NUMBERS[i] }));

  return {
    pointName: ctx?.pointName ?? t.summaries.previewNoPoint,
    zoneName: ctx?.zoneName ?? t.summaries.previewNoZone,
    zoneEmoji: ctx?.zoneEmoji ?? null,
    accountingMode: isZoneAccountingMode(ctx?.accountingMode) ? ctx.accountingMode : "counters",
    occurredAt: new Date(Date.UTC(2026, 6, 8, 22, 0)),
    readings,
    // Ненулевая разница в демо (было 0, при этом 1345+370=1715 — "сошлось"
    // ровно случайно) — иначе индикатор ✅/⚠️ (telegram-format.ts,
    // diffEmoji) выглядел статичным в предпросмотре, хотя на деле он
    // зависит от реальных данных (фидбек пользователя 2026-07-12: "не
    // видно, что иконка разницы динамическая").
    cashAmount: 1345,
    mobileAmount: 370,
    calculatedRevenue: 1715,
    difference: 25,
    returnsCount: 0,
    operatorName: ctx?.operatorName ?? t.summaries.previewNoOperator,
    operatorColorTag: ctx?.operatorColorTag ?? null,
  };
}

export default function ZoneSummaryEditorPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState<ZoneSummarySettingsData>(ZONE_SUMMARY_DEFAULTS);
  const [previewContext, setPreviewContext] = useState<SummaryPreviewContext | null>(null);

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

  const previewText = useMemo(
    () => formatZoneSummaryTelegram(buildPreviewData(previewContext, t), settings),
    [settings, previewContext, t]
  );

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
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings/summaries" className="mb-2 w-fit text-caption-airbnb font-semibold text-primary">
            ← {t.summaries.listTitle}
          </Link>
          <h1 className="text-screen-title">{t.summaries.zoneEditorTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.zoneEditorSub}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
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
                <span className="mb-3 text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.previewCardLabel}
                </span>
                <TelegramPreviewBubble text={previewText} time="22:00" />
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
