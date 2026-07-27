// Минимальные ambient-типы для @point-of-sale/receipt-printer-encoder —
// пакет не поставляет собственных .d.ts (2026-07-27). Описаны только методы,
// которые реально используются в src/lib/print/thermal-bluetooth.ts — не
// полное покрытие всего API библиотеки (barcode/qrcode/box/pulse и т.п.
// сюда намеренно не добавлены, раз не используются).
declare module "@point-of-sale/receipt-printer-encoder" {
  export interface ReceiptPrinterEncoderOptions {
    language: "esc-pos" | "star-prnt" | "star-line";
    columns: number;
  }

  export type ReceiptEncoderAlign = "left" | "center" | "right";

  export interface ReceiptEncoderTableColumn {
    width: number;
    align?: ReceiptEncoderAlign;
    marginLeft?: number;
    marginRight?: number;
  }

  export type ReceiptEncoderTableCell = string | ((encoder: ReceiptPrinterEncoder) => ReceiptPrinterEncoder);

  export default class ReceiptPrinterEncoder {
    constructor(options: ReceiptPrinterEncoderOptions);
    initialize(): this;
    text(value: string): this;
    line(value: string): this;
    newline(count?: number): this;
    bold(enabled?: boolean): this;
    align(position: ReceiptEncoderAlign): this;
    height(scale: number): this;
    width(scale: number): this;
    table(columns: ReceiptEncoderTableColumn[], rows: ReceiptEncoderTableCell[][]): this;
    cut(type?: "partial" | "full"): this;
    raw(bytes: number[]): this;
    encode(): Uint8Array;
  }
}
