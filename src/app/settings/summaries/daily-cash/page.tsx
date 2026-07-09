"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Switch } from "@/components/ui/switch";
import { WheelTimePicker } from "@/components/wheel-time-picker";
import { TelegramPreviewBubble } from "@/components/telegram-preview-bubble";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { cn } from "@/lib/utils";
import { formatDailyCashSummaryTelegram } from "@/lib/summary-channels/telegram-format";
import type { DailyCashSummaryData } from "@/lib/summary-channels/types";
import {
  DAILY_CASH_SUMMARY_DEFAULTS,
  type DailyCashSendMode,
  type DailyCashSummarySettingsData,
} from "@/lib/summary-settings";
import type { SummaryPreviewContext } from "@/lib/summary-preview-context";
import type { Dictionary } from "@/lib/i18n";

// См. zone/page.tsx — числа демо, названия (точка/зоны) настоящие.
const SAMPLE_ZONE_REVENUE = [1715, 265, 50];

function buildPreviewData(ctx: SummaryPreviewContext | null, t: Dictionary): DailyCashSummaryData {
  const zoneNames = ctx && ctx.zoneNames.length > 0 ? ctx.zoneNames : [t.summaries.previewNoZone];
  const zoneBreakdown = zoneNames
    .slice(0, 3)
    .map((zoneName, i) => ({ zoneName, revenue: SAMPLE_ZONE_REVENUE[i] ?? 0 }));

  return {
    pointName: ctx?.pointName ?? t.summaries.previewNoPoint,
    businessDate: new Date(Date.UTC(2026, 6, 8)),
    cashAmount: 1345,
    mobileAmount: 805,
    expenses: 120,
    zoneBreakdown,
    cashOnHand: 620,
    forcedIncomplete: false,
  };
}

function parseTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map(Number);
  return { hour: h || 0, minute: m || 0 };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function DailyCashSummaryEditorPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState<DailyCashSummarySettingsData>(DAILY_CASH_SUMMARY_DEFAULTS);
  const [previewContext, setPreviewContext] = useState<SummaryPreviewContext | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/tenant/summary-settings/daily-cash"),
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

  function patch(partial: Partial<DailyCashSummarySettingsData>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    fetch("/api/tenant/summary-settings/daily-cash", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  const previewText = useMemo(
    () => formatDailyCashSummaryTelegram(buildPreviewData(previewContext, t), settings),
    [settings, previewContext, t]
  );

  const toggleRows: Array<{ key: keyof DailyCashSummarySettingsData; label: string; sub: string }> = [
    { key: "showCash", label: t.summaries.dcShowCashLabel, sub: t.summaries.dcShowCashSub },
    { key: "showExpenses", label: t.summaries.dcShowExpensesLabel, sub: t.summaries.dcShowExpensesSub },
    { key: "showZoneBreakdown", label: t.summaries.dcShowZoneBreakdownLabel, sub: t.summaries.dcShowZoneBreakdownSub },
    { key: "showCashOnHand", label: t.summaries.dcShowCashOnHandLabel, sub: t.summaries.dcShowCashOnHandSub },
  ];

  if (checking) return null;

  const fixedTime = parseTime(settings.fixedTime);
  const boundaryTime = parseTime(settings.businessDayBoundary);

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings/summaries" className="mb-2 w-fit text-caption-airbnb font-semibold text-primary">
            ← {t.summaries.listTitle}
          </Link>
          <h1 className="text-screen-title">{t.summaries.dailyCashEditorTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.dailyCashEditorSub}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-2 text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.whenToSendCardLabel}
                </span>

                <button
                  type="button"
                  onClick={() => patch({ sendMode: "event" as DailyCashSendMode })}
                  className={cn(
                    "mb-2.5 flex w-full items-start gap-2.5 rounded-control border p-3.5 text-left transition-colors",
                    settings.sendMode === "event" ? "border-primary bg-primary/10" : "border-border bg-muted/20"
                  )}
                >
                  <span
                    className={cn(
                      "relative mt-0.5 size-5 shrink-0 rounded-full border-2",
                      settings.sendMode === "event" ? "border-primary" : "border-muted-foreground/40"
                    )}
                  >
                    {settings.sendMode === "event" && (
                      <span className="absolute inset-[3px] rounded-full bg-primary" />
                    )}
                  </span>
                  <span>
                    <span className="block text-body-airbnb font-bold">{t.summaries.modeEventName}</span>
                    <span className="mt-0.5 block text-caption-airbnb leading-relaxed">{t.summaries.modeEventSub}</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => patch({ sendMode: "fixed" as DailyCashSendMode })}
                  className={cn(
                    "mb-1 flex w-full items-start gap-2.5 rounded-control border p-3.5 text-left transition-colors",
                    settings.sendMode === "fixed" ? "border-primary bg-primary/10" : "border-border bg-muted/20"
                  )}
                >
                  <span
                    className={cn(
                      "relative mt-0.5 size-5 shrink-0 rounded-full border-2",
                      settings.sendMode === "fixed" ? "border-primary" : "border-muted-foreground/40"
                    )}
                  >
                    {settings.sendMode === "fixed" && (
                      <span className="absolute inset-[3px] rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-airbnb font-bold">{t.summaries.modeFixedName}</span>
                    <span className="mt-0.5 block text-caption-airbnb leading-relaxed">{t.summaries.modeFixedSub}</span>
                    {settings.sendMode === "fixed" && (
                      <span className="mt-2 block" onClick={(e) => e.stopPropagation()}>
                        <WheelTimePicker
                          hour={fixedTime.hour}
                          minute={fixedTime.minute}
                          onChange={(v) => patch({ fixedTime: formatTime(v.hour, v.minute) })}
                        />
                      </span>
                    )}
                  </span>
                </button>

                <div className="flex items-center justify-between gap-3 border-t border-border py-3">
                  <div className="min-w-0">
                    <div className="text-body-airbnb">{t.summaries.businessDayBoundaryLabel}</div>
                    <div className="text-caption-airbnb">{t.summaries.businessDayBoundarySub}</div>
                  </div>
                  <WheelTimePicker
                    hour={boundaryTime.hour}
                    minute={boundaryTime.minute}
                    onChange={(v) => patch({ businessDayBoundary: formatTime(v.hour, v.minute) })}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border py-3">
                  <div className="min-w-0">
                    <div className="text-body-airbnb">{t.summaries.skipIfNoSubmissionsLabel}</div>
                    <div className="text-caption-airbnb">{t.summaries.skipIfNoSubmissionsSub}</div>
                  </div>
                  <Switch
                    checked={settings.skipIfNoSubmissions}
                    onCheckedChange={(v) => patch({ skipIfNoSubmissions: v })}
                    className="shrink-0"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border py-3">
                  <div className="min-w-0">
                    <div className="text-body-airbnb">{t.summaries.updateOnLateSubmissionLabel}</div>
                    <div className="text-caption-airbnb">{t.summaries.updateOnLateSubmissionSub}</div>
                  </div>
                  <Switch
                    checked={settings.updateOnLateSubmission}
                    onCheckedChange={(v) => patch({ updateOnLateSubmission: v })}
                    className="shrink-0"
                  />
                </div>
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.compositionCardLabel}
                </span>
                {toggleRows.map((row) => (
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
                <TelegramPreviewBubble text={previewText} time="03:07" />
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
