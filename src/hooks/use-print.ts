"use client";

import { useEffect, useState } from "react";
import type { ReceiptBranding } from "@/lib/print/receipt-document";

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

interface PrintAvailability {
  available: boolean;
  branding: ReceiptBranding;
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
  showTelegramQr: true,
};

/** Владелец: доступна ли печать прямо сейчас (тенант включил + этот браузер помечен как "с принтером"). */
export function useOwnerPrintAvailable(): PrintAvailability {
  const [hasPrinterLocal] = useOwnerHasPrinterLocal();
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
            showTelegramQr: data.receiptShowTelegramQr ?? true,
          },
        });
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  return { available: state.printingEnabled && hasPrinterLocal, branding: state.branding };
}

/** Сотрудник: доступна ли печать на этом (активированном) устройстве прямо сейчас. */
export function useOperatorPrintAvailable(): PrintAvailability {
  const [state, setState] = useState<{ available: boolean; branding: ReceiptBranding; operatorName: string | null }>({
    available: false,
    branding: EMPTY_BRANDING,
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
            showTelegramQr: data.receiptShowTelegramQr ?? true,
          },
          operatorName: data.operatorName ?? null,
        });
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  return state;
}
