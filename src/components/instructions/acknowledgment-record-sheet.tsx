"use client";

import { useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import type { AcknowledgmentRecordItem } from "@/lib/instructions/client-types";

function formatDuration(seconds: number, minutesLabel: string, secondsLabel: string): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} ${minutesLabel} ${s} ${secondsLabel}` : `${s} ${secondsLabel}`;
}

// Детали записи (docs/spec/07-instructions.md, "Макеты и вёрстка") — открывается
// тапом по карточке в мобильной раскладке журнала; на десктопе те же поля уже
// видны прямо в колонках таблицы, этот sheet там не нужен (см. страницу).
export function AcknowledgmentRecordSheet({
  record,
  onClose,
  onChanged,
}: {
  record: AcknowledgmentRecordItem | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useI18n();
  const [view, setView] = useState<"details" | "confirm-delete">("details");
  const [busy, setBusy] = useState(false);

  function handleClose() {
    setView("details");
    onClose();
  }

  function downloadPdf() {
    if (!record) return;
    window.open(`/api/instructions/records/${record.id}/pdf`, "_blank");
  }

  async function requestReacknowledgment() {
    if (!record) return;
    setBusy(true);
    try {
      await fetch(`/api/instructions/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiresReacknowledgment: true }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!record) return;
    setBusy(true);
    try {
      await fetch(`/api/instructions/records/${record.id}`, { method: "DELETE" });
      handleClose();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string][] = record
    ? [
        [t.instructions.fieldFullName, `${record.lastName} ${record.firstName}`],
        [t.instructions.fieldPhone, record.phone],
        [t.instructions.fieldBirthDate, new Date(record.birthDate).toLocaleDateString()],
        [t.instructions.fieldReadingTime, formatDuration(record.readingSeconds, t.instructions.minutesShort, t.instructions.secondsShort)],
        [t.instructions.fieldIp, record.ip],
        [t.instructions.fieldDevice, record.deviceLabel ?? "—"],
        [t.instructions.fieldBrowser, record.browserLabel ?? "—"],
        [t.instructions.fieldVersion, `v${record.versionNumber}${record.isStale ? ` · ${t.instructions.staleLabel}` : ""}`],
      ]
    : [];

  return (
    <BottomSheet open={record !== null} onClose={handleClose}>
      {record && view === "details" && (
        <div className="flex flex-col gap-1 pt-2 pb-1">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{record.instructionTitle}</h2>
          <div className="mt-2 flex flex-col">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0">
                <span className="text-caption-airbnb">{label}</span>
                <span className="text-body-airbnb font-medium">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <PressableScale>
              <Button type="button" variant="outline" className="w-full gap-2" onClick={downloadPdf}>
                <Download className="size-4" />
                {t.instructions.downloadPdfButton}
              </Button>
            </PressableScale>
            <PressableScale>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={requestReacknowledgment}
                disabled={busy || record.requiresReacknowledgment}
              >
                <RotateCcw className="size-4" />
                {record.requiresReacknowledgment
                  ? t.instructions.reacknowledgmentRequested
                  : t.instructions.requestReacknowledgmentButton}
              </Button>
            </PressableScale>
            <button
              type="button"
              onClick={() => setView("confirm-delete")}
              className="mx-auto mt-1 text-caption-airbnb font-semibold text-destructive"
            >
              {t.instructions.deleteRecordButton}
            </button>
          </div>
        </div>
      )}
      {record && view === "confirm-delete" && (
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.instructions.deleteRecordConfirmTitle}</h2>
          <p className="text-body-airbnb text-muted-foreground">{t.instructions.deleteRecordConfirmHint}</p>
          <PressableScale>
            <Button type="button" variant="destructive" className="w-full" onClick={confirmDelete} disabled={busy}>
              {t.instructions.deleteRecordButton}
            </Button>
          </PressableScale>
          <PressableScale>
            <Button type="button" variant="outline" className="w-full" onClick={() => setView("details")}>
              {t.common.cancel}
            </Button>
          </PressableScale>
        </div>
      )}
    </BottomSheet>
  );
}
