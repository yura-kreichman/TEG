"use client";

import { useEffect, useState } from "react";
import type { PrintMethod, ReceiptBranding, ReceiptPaperWidth } from "@/lib/print/receipt-document";

// Владелец не привязан к PointDevice (входит email+паролем с любого
// браузера, в отличие от Оператора, у которого есть активированное
// устройство) — поэтому тумблер "есть принтер" для Владельца хранится
// локально в этом браузере, не на сервере (запрос пользователя 2026-07-20:
// ручной тумблер, автоопределения нет и быть не может).
const OWNER_HAS_PRINTER_KEY = "rentos-owner-has-printer";

export function useOwnerHasPrinterLocal() {
  const [hasPrinter, setHasPrinterState] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setHasPrinterState(localStorage.getItem(OWNER_HAS_PRINTER_KEY) === "1");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  function setHasPrinter(value: boolean) {
    localStorage.setItem(OWNER_HAS_PRINTER_KEY, value ? "1" : "0");
    setHasPrinterState(value);
  }
  return [hasPrinter, setHasPrinter] as const;
}

// Ширина рулона/тип принтера у Владельца — та же логика "своё на каждый
// браузер", что и hasPrinter выше (запрос пользователя 2026-07-26: "у
// Владельца тоже нужна настройка, так как он тоже печатает из своего
// приложения") — раньше жило на тенанте одним общим полем, но печать
// физически привязана к конкретному устройству/браузеру, а не к бизнесу
// целиком (тот же аргумент, по которому у Оператора это PointDevice.receiptPaperWidth,
// см. points/page.tsx).
const OWNER_PAPER_WIDTH_KEY = "rentos-owner-paper-width";

export function useOwnerPaperWidthLocal() {
  const [paperWidth, setPaperWidthState] = useState<ReceiptPaperWidth>("58");
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const stored = localStorage.getItem(OWNER_PAPER_WIDTH_KEY);
    if (stored === "58" || stored === "80" || stored === "a4") setPaperWidthState(stored);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  function setPaperWidth(value: ReceiptPaperWidth) {
    localStorage.setItem(OWNER_PAPER_WIDTH_KEY, value);
    setPaperWidthState(value);
  }
  return [paperWidth, setPaperWidth] as const;
}

// Способ печати у Владельца — та же логика "своё на каждый браузер", что и
// paperWidth/hasPrinter выше (2026-07-27) — см. PrintMethod в receipt-document.ts.
const OWNER_PRINT_METHOD_KEY = "rentos-owner-print-method";

export function useOwnerPrintMethodLocal() {
  const [printMethod, setPrintMethodState] = useState<PrintMethod>("browser");
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const stored = localStorage.getItem(OWNER_PRINT_METHOD_KEY);
    if (stored === "browser" || stored === "bluetooth") setPrintMethodState(stored);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  function setPrintMethod(value: PrintMethod) {
    localStorage.setItem(OWNER_PRINT_METHOD_KEY, value);
    setPrintMethodState(value);
  }
  return [printMethod, setPrintMethod] as const;
}

interface PrintAvailability {
  available: boolean;
  branding: ReceiptBranding;
  printMethod: PrintMethod;
  /** Имя Сотрудника, напечатавшего документ (запрос пользователя 2026-07-20:
   * строка даты на квитанции должна сопровождаться исполнителем) — только у
   * Оператора (Владелец подставляет статичный t.common.ownerLabel сам, без
   * похода на сервер). */
  operatorName?: string | null;
}

const EMPTY_BRANDING: ReceiptBranding = {
  tenantName: "",
  logoUrl: null,
  showLogo: true,
  showTenantName: true,
  compactHeader: false,
  paperWidth: "58",
};

/** Владелец: доступна ли печать прямо сейчас (тенант включил + этот браузер помечен как "с принтером"). */
export function useOwnerPrintAvailable(): PrintAvailability {
  const [hasPrinterLocal] = useOwnerHasPrinterLocal();
  const [paperWidthLocal] = useOwnerPaperWidthLocal();
  const [printMethodLocal] = useOwnerPrintMethodLocal();
  const [state, setState] = useState<{ printingEnabled: boolean; branding: ReceiptBranding }>({
    printingEnabled: false,
    branding: EMPTY_BRANDING,
  });
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/tenant/system-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setState({
          printingEnabled: Boolean(data.printingEnabled),
          branding: {
            tenantName: data.tenantName ?? "",
            logoUrl: data.logoUrl ?? null,
            showLogo: data.receiptShowLogo ?? true,
            showTenantName: data.receiptShowTenantName ?? true,
            compactHeader: data.receiptCompactHeader ?? false,
            // Заполняется ниже, отдельно от серверного fetch — источник
            // локальный (см. paperWidthLocal), не приходит с сервером.
            paperWidth: "58",
          },
        });
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  return {
    available: state.printingEnabled && hasPrinterLocal,
    branding: { ...state.branding, paperWidth: paperWidthLocal },
    printMethod: printMethodLocal,
  };
}

/** Сотрудник: доступна ли печать на этом (активированном) устройстве прямо сейчас. */
export function useOperatorPrintAvailable(): PrintAvailability {
  const [state, setState] = useState<{
    available: boolean;
    branding: ReceiptBranding;
    printMethod: PrintMethod;
    operatorName: string | null;
  }>({
    available: false,
    branding: EMPTY_BRANDING,
    printMethod: "browser",
    operatorName: null,
  });
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/operator/print-branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setState({
          available: Boolean(data.available),
          branding: {
            tenantName: data.tenantName ?? "",
            logoUrl: data.logoUrl ?? null,
            showLogo: data.receiptShowLogo ?? true,
            showTenantName: data.receiptShowTenantName ?? true,
            compactHeader: data.receiptCompactHeader ?? false,
            paperWidth: data.receiptPaperWidth ?? "58",
          },
          printMethod: data.printMethod === "bluetooth" ? "bluetooth" : "browser",
          operatorName: data.operatorName ?? null,
        });
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  return state;
}
