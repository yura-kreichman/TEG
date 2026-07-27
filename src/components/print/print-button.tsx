"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { openPrintDocument, type PrintDocumentData, type PrintMethod, type ReceiptBranding } from "@/lib/print/receipt-document";
import { useThermalPrinter } from "@/hooks/use-thermal-printer";
import { useI18n } from "@/components/i18n-provider";

// Кнопка печати — общий компонент для всех документов (квитанция/Z-отчёт/
// слип инкассации/выписка баланса, запрос пользователя 2026-07-20). Печать —
// всегда по требованию, никогда автоматически (решение пользователя того же
// дня: "Сотрудник или Владелец могут отказаться от печати квитанции" —
// кнопка просто не появляется, если недоступна, а не появляется отключённой).
//
// Кулдаун после тапа (запрос пользователя 2026-07-21: реальная распечатка —
// вторая, оборванная копия шапки, переходящая в мусор символов) — дешёвые
// Bluetooth ESC/POS принтеры печатают медленно и не умеют в очередь заданий;
// если второе window.print() уйдёт раньше, чем первое задание долетит до
// принтера по Bluetooth, поток данных на принтере схлопывается в мусор
// именно в такой форме (первая копия допечатывается, вторая рвётся на
// середине). Кнопка ничего не знает о типе принтера и не может дождаться
// реального завершения печати (afterprint на части Android WebView не
// срабатывает вообще — та же причина, по которой у triggerPrint в
// receipt-document.ts уже есть 5-секундный fallback) — поэтому здесь просто
// фиксированный кулдаун с той же логикой запаса.
const PRINT_COOLDOWN_MS = 4000;

export function PrintButton({
  label,
  data,
  branding,
  printMethod = "browser",
  size = "sm",
  className,
}: {
  label: string;
  data: PrintDocumentData;
  branding: ReceiptBranding;
  /** "bluetooth" — печать напрямую по Web Bluetooth (2026-07-27), см. use-thermal-printer.ts.
   *  По умолчанию "browser" — прежнее поведение, без единого изменения. */
  printMethod?: PrintMethod;
  size?: "sm" | "default";
  className?: string;
}) {
  const t = useI18n();
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thermalPrinter = useThermalPrinter(branding.paperWidth);

  async function handleClick() {
    if (printing) return;
    setPrinting(true);
    setError(null);
    // Bluetooth выбран, но принтер не готов (не сопряжён/не поддерживается/
    // ошибка связи) — НЕ проваливаемся тихо в браузерную печать (план
    // 2026-07-27: "с понятной ошибкой оператору, не тихим провалом"), иначе
    // Сотрудник решит, что чек напечатан, хотя реально ушёл в системный
    // диалог печати, который он выключил именно из-за этого режима.
    if (printMethod === "bluetooth") {
      if (thermalPrinter.status !== "ready") {
        setError(thermalPrinter.errorMessage ?? t.operatorApp.thermalPrinterNotConnectedError);
        setPrinting(false);
        return;
      }
      try {
        await thermalPrinter.print(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setTimeout(() => setPrinting(false), PRINT_COOLDOWN_MS);
      return;
    }
    openPrintDocument(data, branding);
    setTimeout(() => setPrinting(false), PRINT_COOLDOWN_MS);
  }

  return (
    <div className="flex flex-col gap-1">
      <PressableScale>
        <Button
          type="button"
          variant="outline"
          size={size}
          className={className ?? "gap-1.5"}
          disabled={printing}
          onClick={handleClick}
        >
          <Printer className="size-4" />
          {label}
        </Button>
      </PressableScale>
      {error && <p className="text-caption-airbnb text-destructive">{error}</p>}
    </div>
  );
}
