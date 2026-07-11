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
import { formatShiftCloseSummaryTelegram } from "@/lib/summary-channels/telegram-format";
import type { ShiftCloseSummaryData } from "@/lib/summary-channels/types";
import { SHIFT_CLOSE_SUMMARY_DEFAULTS, type ShiftCloseSummarySettingsData } from "@/lib/summary-settings";
import type { SummaryPreviewContext } from "@/lib/summary-preview-context";
import type { Dictionary } from "@/lib/i18n";

// См. zone/page.tsx — числа демо, имя оператора настоящее.
// advanceAmount ненулевой (было 0) — formatShiftCloseSummaryTelegram
// показывает Аванс только при amount > 0, с нулём тумблер showAdvance было
// невозможно проверить в превью (фидбек пользователя 2026-07-12: "Аванс
// вообще не отображается" — это был как раз нулевой демо-аванс, не баг формата).
function buildPreviewData(ctx: SummaryPreviewContext | null, t: Dictionary): ShiftCloseSummaryData {
  return {
    operatorName: ctx?.operatorName ?? t.summaries.previewNoOperator,
    operatorColorTag: ctx?.operatorColorTag ?? null,
    startAt: new Date(Date.UTC(2026, 6, 8, 10, 0)),
    endAt: new Date(Date.UTC(2026, 6, 8, 22, 11)),
    minutes: 731,
    rate: 0,
    accrued: 628,
    advanceAmount: 1500,
    bonusAmount: 150,
    toPayOut: 778,
  };
}

export default function ShiftCloseSummaryEditorPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState<ShiftCloseSummarySettingsData>(SHIFT_CLOSE_SUMMARY_DEFAULTS);
  const [previewContext, setPreviewContext] = useState<SummaryPreviewContext | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/tenant/summary-settings/shift-close"),
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

  function patch(partial: Partial<ShiftCloseSummarySettingsData>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    fetch("/api/tenant/summary-settings/shift-close", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  const previewText = useMemo(
    () => formatShiftCloseSummaryTelegram(buildPreviewData(previewContext, t), settings),
    [settings, previewContext, t]
  );

  const rows: Array<{ key: keyof ShiftCloseSummarySettingsData; label: string; sub: string }> = [
    { key: "showPeriod", label: t.summaries.scShowPeriodLabel, sub: t.summaries.scShowPeriodSub },
    { key: "showHours", label: t.summaries.scShowHoursLabel, sub: t.summaries.scShowHoursSub },
    { key: "showAdvance", label: t.summaries.scShowAdvanceLabel, sub: t.summaries.scShowAdvanceSub },
    { key: "showBonus", label: t.summaries.scShowBonusLabel, sub: t.summaries.scShowBonusSub },
    { key: "showTotal", label: t.summaries.scShowTotalLabel, sub: t.summaries.scShowTotalSub },
    { key: "compact", label: t.summaries.scCompactLabel, sub: t.summaries.scCompactSub },
  ];

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings/summaries" className="mb-2 w-fit text-caption-airbnb font-semibold text-primary">
            ← {t.summaries.listTitle}
          </Link>
          <h1 className="text-screen-title">{t.summaries.shiftCloseEditorTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.shiftCloseEditorSub}</p>

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
                <TelegramPreviewBubble text={previewText} time="22:12" />
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
