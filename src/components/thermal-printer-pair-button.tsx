"use client";

import { useState } from "react";
import { Bluetooth, BluetoothConnected, BluetoothOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import { useThermalPrinter } from "@/hooks/use-thermal-printer";
import { cn } from "@/lib/utils";

/**
 * Точка входа сопряжения Bluetooth-принтера (2026-07-27) — только у Сотрудника,
 * не у Владельца: разрешение Web Bluetooth привязано к origin+профилю браузера
 * КОНКРЕТНОГО устройства, Владелец не может сопрячь принтер удалённо со своего
 * компьютера за физическое устройство точки. Показывается только когда
 * PointDevice.printMethod этого устройства = "bluetooth" (тумблер — у
 * Владельца, Точки → Устройства), см. src/lib/print/thermal-bluetooth.ts.
 */
export function ThermalPrinterPairButton() {
  const t = useI18n();
  const { printMethod, branding } = useOperatorPrintAvailable();
  const { status, errorMessage, pair, forget } = useThermalPrinter(branding.paperWidth);
  const [open, setOpen] = useState(false);

  if (printMethod !== "bluetooth" || status === "unsupported") return null;

  const Icon = status === "ready" ? BluetoothConnected : status === "error" ? BluetoothOff : Bluetooth;
  const iconColor = status === "ready" ? "text-success" : status === "error" ? "text-destructive" : "text-muted-foreground";

  return (
    <>
      <PressableScale>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={t.operatorApp.thermalPrinterTitle}
          className={cn("size-8 shrink-0 rounded-lg border-border", iconColor)}
        >
          <Icon className="size-4" />
        </Button>
      </PressableScale>

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.thermalPrinterTitle}</h2>
            <p className="text-caption-airbnb">{t.operatorApp.thermalPrinterHint}</p>
          </div>

          <div className="flex items-center justify-between rounded-control border border-border p-3">
            <span className="text-body-airbnb">
              {status === "ready" && t.operatorApp.thermalPrinterStatusReady}
              {status === "unpaired" && t.operatorApp.thermalPrinterStatusUnpaired}
              {status === "connecting" && t.operatorApp.thermalPrinterStatusConnecting}
              {status === "error" && (errorMessage || t.operatorApp.thermalPrinterStatusError)}
            </span>
            <Icon className={cn("size-5 shrink-0", iconColor)} />
          </div>

          {status === "ready" ? (
            <PressableScale>
              <Button type="button" variant="outline" className="h-12 w-full" onClick={forget}>
                {t.operatorApp.thermalPrinterForgetButton}
              </Button>
            </PressableScale>
          ) : (
            <PressableScale>
              <Button
                type="button"
                className="h-12 w-full"
                disabled={status === "connecting"}
                onClick={pair}
              >
                {t.operatorApp.thermalPrinterPairButton}
              </Button>
            </PressableScale>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
