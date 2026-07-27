"use client";

import { useCallback, useEffect, useState } from "react";
import {
  buildEscPosCommands,
  columnsForPaperWidth,
  connectAndPrint,
  forgetSavedDevice,
  getSavedDevice,
  isWebBluetoothSupported,
  rememberDevice,
  requestThermalPrinter,
} from "@/lib/print/thermal-bluetooth";
import type { PrintDocumentData, ReceiptPaperWidth } from "@/lib/print/receipt-document";

export type ThermalPrinterStatus = "unsupported" | "unpaired" | "connecting" | "ready" | "error";

// Единая точка UI для прямой Bluetooth-печати (2026-07-27) — см. thermal-
// bluetooth.ts для причин архитектуры. "unsupported" — сам Web Bluetooth
// недоступен в этом браузере (iOS Safari и т.п.), UI в этом случае просто не
// предлагает Bluetooth-режим вообще, не пытается и не показывает ошибку.
export function useThermalPrinter(paperWidth: ReceiptPaperWidth) {
  const [status, setStatus] = useState<ThermalPrinterStatus>("unpaired");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isWebBluetoothSupported()) {
      setStatus("unsupported");
      return;
    }
    getSavedDevice().then((device) => setStatus(device ? "ready" : "unpaired"));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pair = useCallback(async () => {
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const device = await requestThermalPrinter();
      rememberDevice(device);
      setStatus("ready");
    } catch (err) {
      // NotFoundError — пользователь закрыл диалог выбора устройства сам
      // (или устройств не нашлось), не настоящая ошибка, просто возврат к
      // "не сопряжено" без сообщения.
      if (err instanceof Error && err.name === "NotFoundError") {
        setStatus("unpaired");
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const forget = useCallback(() => {
    forgetSavedDevice();
    setStatus("unpaired");
    setErrorMessage(null);
  }, []);

  const print = useCallback(
    async (data: PrintDocumentData) => {
      const device = await getSavedDevice();
      if (!device) {
        setStatus("unpaired");
        throw new Error("Принтер не подключён");
      }
      setStatus("connecting");
      setErrorMessage(null);
      try {
        const commands = buildEscPosCommands(data, columnsForPaperWidth(paperWidth));
        await connectAndPrint(device, commands);
        setStatus("ready");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
        throw err;
      }
    },
    [paperWidth]
  );

  return { status, errorMessage, pair, forget, print };
}
