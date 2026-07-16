"use client";

import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
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
  const { saved: deleted, pulse: deletePulse } = useSavePulse();

  function handleClose() {
    setView("details");
    onClose();
  }

  function downloadPdf() {
    if (!record) return;
    window.open(`/api/instructions/records/${record.id}/pdf`, "_blank");
  }

  async function confirmDelete() {
    if (!record) return;
    setBusy(true);
    try {
      await fetch(`/api/instructions/records/${record.id}`, { method: "DELETE" });
      onChanged();
      deletePulse(handleClose);
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
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{record.instructionTitle}</h2>
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
                variant="destructive"
                className="w-full gap-2"
                onClick={() => setView("confirm-delete")}
              >
                <Trash2 className="size-4" />
                {t.common.delete}
              </Button>
            </PressableScale>
          </div>
        </div>
      )}
      {record && view === "confirm-delete" && (
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.instructions.deleteRecordConfirmTitle}</h2>
          <p className="text-body-airbnb text-muted-foreground">{t.instructions.deleteRecordConfirmHint}</p>
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={confirmDelete} disabled={busy} deleted={deleted} />
          </PressableScale>
        </div>
      )}
    </BottomSheet>
  );
}
