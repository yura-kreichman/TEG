"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { openPrintDocument, type PrintDocumentData, type ReceiptBranding } from "@/lib/print/receipt-document";

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
  size = "sm",
  className,
}: {
  label: string;
  data: PrintDocumentData;
  branding: ReceiptBranding;
  size?: "sm" | "default";
  className?: string;
}) {
  const [printing, setPrinting] = useState(false);

  function handleClick() {
    if (printing) return;
    setPrinting(true);
    openPrintDocument(data, branding);
    setTimeout(() => setPrinting(false), PRINT_COOLDOWN_MS);
  }

  return (
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
  );
}
