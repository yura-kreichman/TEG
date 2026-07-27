"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  buildEscPosCommands,
  columnsForPaperWidth,
  connectAndPrint,
  forgetSavedDevice,
  getPairedDevice,
  getSavedDevice,
  isWebBluetoothSupported,
  requestThermalPrinter,
  subscribePairedDevice,
} from "@/lib/print/thermal-bluetooth";
import type { PrintDocumentData, ReceiptPaperWidth } from "@/lib/print/receipt-document";

export type ThermalPrinterStatus = "unsupported" | "unpaired" | "connecting" | "ready" | "error";

// Бросается из print(), когда устройство не сопряжено на ЭТОЙ странице —
// вызывающая сторона (PrintButton и т.п.) ловит по message и подставляет
// локализованный текст (t.operatorApp.thermalPrinterNotConnectedError),
// здесь своей i18n-строки нет намеренно (хук вне React-компонента i18n не видит).
export const PRINTER_NOT_PAIRED = "PRINTER_NOT_PAIRED";

// Единая точка UI для прямой Bluetooth-печати (2026-07-27, переписано
// 2026-07-28) — статус сопряжённого устройства читается из ОБЩЕГО хранилища
// (thermal-bluetooth.ts, useSyncExternalStore), а не из локального
// React-state этого хука. Реальный баг с реального устройства: раньше
// каждая кнопка печати создавала свой ОТДЕЛЬНЫЙ экземпляр этого хука —
// сопряжение через иконку/Настройки не было видно кнопке печати, та всегда
// видела "не подключён", даже сразу после успешного выбора устройства.
// "unsupported" — сам Web Bluetooth недоступен в этом браузере (iOS Safari
// и т.п.), UI в этом случае просто не предлагает Bluetooth-режим вообще.
export function useThermalPrinter(paperWidth: ReceiptPaperWidth) {
  const device = useSyncExternalStore(subscribePairedDevice, getPairedDevice, () => null);
  const [transient, setTransient] = useState<"connecting" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const supported = isWebBluetoothSupported();

  const status: ThermalPrinterStatus = !supported
    ? "unsupported"
    : transient === "connecting"
      ? "connecting"
      : transient === "error"
        ? "error"
        : device
          ? "ready"
          : "unpaired";

  // Прогрессивное улучшение (см. thermal-bluetooth.ts): пробуем
  // восстановить устройство через getDevices(), на случай если Chrome
  // когда-нибудь включит это без флага — на большинстве реальных браузеров
  // сейчас это no-op (getDevices недоступен), не единственный источник
  // истины, просто попытка.
  useEffect(() => {
    if (supported) getSavedDevice();
  }, [supported]);

  const pair = useCallback(async () => {
    setTransient("connecting");
    setErrorMessage(null);
    try {
      await requestThermalPrinter();
      setTransient(null);
    } catch (err) {
      // NotFoundError — пользователь закрыл диалог выбора устройства сам
      // (или устройств не нашлось), не настоящая ошибка, просто возврат к
      // "не сопряжено" без сообщения.
      if (err instanceof Error && err.name === "NotFoundError") {
        setTransient(null);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setTransient("error");
    }
  }, []);

  const forget = useCallback(() => {
    forgetSavedDevice();
    setTransient(null);
    setErrorMessage(null);
  }, []);

  const print = useCallback(
    async (data: PrintDocumentData) => {
      const currentDevice = getPairedDevice();
      if (!currentDevice) {
        throw new Error(PRINTER_NOT_PAIRED);
      }
      setTransient("connecting");
      setErrorMessage(null);
      try {
        const commands = buildEscPosCommands(data, columnsForPaperWidth(paperWidth));
        await connectAndPrint(currentDevice, commands);
        setTransient(null);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setTransient("error");
        throw err;
      }
    },
    [paperWidth]
  );

  return { status, errorMessage, pair, forget, print };
}
