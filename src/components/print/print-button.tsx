"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { openPrintDocument, type PrintDocumentData, type ReceiptBranding } from "@/lib/print/receipt-document";

// Кнопка печати — общий компонент для всех документов (квитанция/Z-отчёт/
// слип инкассации/выписка баланса, запрос пользователя 2026-07-20). Печать —
// всегда по требованию, никогда автоматически (решение пользователя того же
// дня: "Сотрудник или Владелец могут отказаться от печати квитанции" —
// кнопка просто не появляется, если недоступна, а не появляется отключённой).
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
  return (
    <PressableScale>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className ?? "gap-1.5"}
        onClick={() => openPrintDocument(data, branding)}
      >
        <Printer className="size-4" />
        {label}
      </Button>
    </PressableScale>
  );
}
