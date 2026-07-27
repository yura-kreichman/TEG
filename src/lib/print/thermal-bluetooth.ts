import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import type { PrintDocumentData, PrintLine } from "./receipt-document";

// Прямая печать по Web Bluetooth (2026-07-27) — обход системной печати
// Android и любого стороннего Print Service-моста целиком. Найдено
// исследованием (см. память проекта, MHT-P5801): Chrome на Android сам
// растеризует страницу в PDF на DPI, не гарантированно совпадающем с
// печатающей головкой (управляется политикой PrintRasterizePdfDpi,
// недоступной на обычном устройстве) — это происходит ДО того, как
// что-либо от RentOS участвует, поэтому предыдущие 2 инцидента (футер,
// QR-код) не получилось починить правкой CSS/контента, только полным
// удалением фичи. Здесь вместо HTML-страницы, которую кто-то ещё должен
// сфотографировать/растеризовать, отправляются НАСТОЯЩИЕ ESC/POS-команды
// прямо в Bluetooth-характеристику принтера — тот же принцип, что и у
// тестовой печати самого моста (она печатает чисто, в отличие от системной).
//
// Логотип НЕ печатается в этом режиме (сознательное ограничение v1) —
// растровые картинки по ESC/POS сами по себе не редкая причина зависаний на
// дешёвых клонах контроллеров, а вся цель этого режима — максимальная
// надёжность. Печатается только текст (то же самое содержимое, что и в
// HTML-версии, без логотипа).

// GATT service UUID у дешёвых Bluetooth LE ESC/POS-принтеров НЕ
// стандартизирован — эти два самых распространённых кандидата у типичных
// UART-мостов (ISSC/Bluetooth transparent UART и конвенция модуля HM-10).
// Конкретный UUID для КОНКРЕТНОЙ модели принтера подтверждается только живым
// тестом — see docs/spec нет, потому что это внешнее железо, не наш код.
const CANDIDATE_SERVICE_UUIDS = [
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC/Bluetooth transparent UART — частый выбор у китайских термопринтеров
  "0000ffe0-0000-1000-8000-00805f9b34fb", // HM-10-совместимые модули
  "000018f0-0000-1000-8000-00805f9b34fb", // ещё один часто встречающийся у ESC/POS BLE
];

const STORAGE_KEY = "rentos-thermal-bt-device-id";

// Общее хранилище выбранного устройства на всю страницу (2026-07-28,
// реальный баг с реального устройства: "выбираю принтер, но при печати
// пишет «не подключён»") — причина была не в Bluetooth, а в том, что каждая
// кнопка печати вызывала свой ОТДЕЛЬНЫЙ экземпляр useThermalPrinter с
// собственным React-состоянием: сопряжение в одном месте (иконка/Настройки)
// никак не было видно другому (кнопка печати). `BluetoothDevice` — не
// сериализуемый объект, его нельзя просто положить в localStorage и
// восстановить по id: единственный способ получить объект заново —
// navigator.bluetooth.getDevices(), а он до сих пор скрыт за флагом Chrome
// chrome://flags/#enable-web-bluetooth-new-permissions-backend (статус
// chromestatus.com/feature/4797798639730688 на 2026-07-28: "In developer
// trial", таргет M159) — на реальных браузерах пользователей это ВСЕГДА
// пустой список, поэтому и восстановления после перезагрузки страницы не
// бывает: это ограничение платформы, не баг здесь. Единственный НАДЁЖНЫЙ
// источник живого объекта — та же вкладка/сессия, в которой отработал
// requestDevice() — вот он и хранится тут, в памяти модуля, общий для всех
// компонентов на странице.
let pairedDevice: BluetoothDevice | null = null;
const listeners = new Set<() => void>();

function setPairedDevice(device: BluetoothDevice | null): void {
  pairedDevice = device;
  if (typeof localStorage !== "undefined") {
    if (device) localStorage.setItem(STORAGE_KEY, device.id);
    else localStorage.removeItem(STORAGE_KEY);
  }
  for (const listener of listeners) listener();
}

/** Текущее сопряжённое устройство (синхронно, для useSyncExternalStore). */
export function getPairedDevice(): BluetoothDevice | null {
  return pairedDevice;
}

export function subscribePairedDevice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Ширина строки в СИМВОЛАХ (не мм) — печатается моноширинным шрифтом самого
// принтера, у него нет "мм", только столбцы. 32/48 — стандартные значения
// для 58/80мм при обычном (не сжатом) шрифте большинства ESC/POS-контроллеров.
export function columnsForPaperWidth(paperWidth: "58" | "80" | "a4"): number {
  return paperWidth === "80" ? 48 : 32;
}

function padLine(label: string, value: string, columns: number): string {
  const room = columns - value.length;
  if (room <= label.length) return `${label.slice(0, Math.max(0, room - 1))} ${value}`;
  return `${label}${" ".repeat(room - label.length)}${value}`;
}

function encodeLine(encoder: ReceiptPrinterEncoder, line: PrintLine, columns: number): ReceiptPrinterEncoder {
  const text = padLine(line.label, line.value, columns);
  if (line.large) encoder.height(2);
  if (line.bold || line.large) encoder.bold(true);
  encoder.line(text);
  if (line.bold || line.large) encoder.bold(false);
  if (line.large) encoder.height(1);
  return encoder;
}

/** Та же модель контента, что buildReceiptBodyHtml (receipt-document.ts) — байты вместо HTML. */
export function buildEscPosCommands(data: PrintDocumentData, columns: number): Uint8Array {
  const encoder = new ReceiptPrinterEncoder({ language: "esc-pos", columns });
  encoder.initialize();

  // Заголовок документа жирным, подзаголовок (точка/дата) обычным текстом
  // ниже — тот же порядок, что в HTML-шапке (receipt-document.ts).
  encoder.align("center");
  encoder.bold(true).line(data.title).bold(false);
  if (typeof data.subtitle === "string") {
    encoder.line(data.subtitle);
  } else if (data.subtitle) {
    encoder.line(data.subtitle.primary);
    if (data.subtitle.secondary) encoder.line(data.subtitle.secondary);
  }
  encoder.align("left");

  for (const section of data.sections) {
    if (section.title) {
      encoder.newline();
      encoder.bold(true).line(section.title.toUpperCase()).bold(false);
    }
    for (const line of section.lines) {
      encodeLine(encoder, line, columns);
    }
    if (section.cutLineAfter) {
      encoder.newline();
      encoder.line("-".repeat(columns));
    }
  }

  if (data.totalLine) {
    encoder.newline();
    encoder.line("-".repeat(columns));
    encodeLine(encoder, { ...data.totalLine, bold: true, large: true }, columns);
  }

  // Без .cut() — сознательно (2026-07-27): у большинства дешёвых Bluetooth
  // ESC/POS receipt-принтеров (в т.ч., вероятно, у MHT-P5801) физически нет
  // автоотрезчика, только отрыв руками — команда автообреза на таком
  // контроллере либо ничего не делает, либо (хуже) не распознаётся и может
  // застопорить буфер, тот же класс риска, что мы и пытаемся здесь убрать.
  // Просто оставляем отступ на отрыв.
  encoder.newline(3);

  return encoder.encode();
}

// --- Web Bluetooth транспорт ---

function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export { isWebBluetoothSupported };

/** По прямому пользовательскому жесту (клик) — запрашивает выбор устройства и запоминает его в общем хранилище. */
export async function requestThermalPrinter(): Promise<BluetoothDevice> {
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: CANDIDATE_SERVICE_UUIDS,
  });
  setPairedDevice(device);
  return device;
}

/**
 * Устройство для печати прямо сейчас — из памяти (эта же вкладка/сессия),
 * либо (прогрессивное улучшение на будущее, см. комментарий у pairedDevice
 * выше) через getDevices(), если когда-нибудь станет доступен без флага —
 * тогда восстановление после перезагрузки заработает само, без правок кода.
 */
export async function getSavedDevice(): Promise<BluetoothDevice | null> {
  if (pairedDevice) return pairedDevice;
  if (!isWebBluetoothSupported() || typeof navigator.bluetooth.getDevices !== "function") return null;
  const savedId = localStorage.getItem(STORAGE_KEY);
  if (!savedId) return null;
  try {
    const devices = await navigator.bluetooth.getDevices();
    const found = devices.find((d) => d.id === savedId) ?? null;
    if (found) setPairedDevice(found);
    return found;
  } catch {
    return null;
  }
}

export function forgetSavedDevice(): void {
  setPairedDevice(null);
}

class ThermalPrinterWriteError extends Error {}

/** Первая найденная характеристика, пригодная для записи, среди всех сервисов устройства. */
async function findWritableCharacteristic(
  server: BluetoothRemoteGATTServer
): Promise<BluetoothRemoteGATTCharacteristic> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    const writable = characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (writable) return writable;
  }
  throw new ThermalPrinterWriteError("Не найдена характеристика для записи на этом устройстве");
}

// 20 байт — безопасный дефолт без согласования расширенного MTU (стандартная
// практика Web Bluetooth, см. память/исследование 2026-07-27).
const CHUNK_SIZE = 20;

async function writeChunked(characteristic: BluetoothRemoteGATTCharacteristic, data: Uint8Array): Promise<void> {
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + CHUNK_SIZE);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValueWithResponse(chunk);
    }
  }
}

export async function connectAndPrint(device: BluetoothDevice, commands: Uint8Array): Promise<void> {
  const server = device.gatt?.connected ? device.gatt : await device.gatt?.connect();
  if (!server) throw new ThermalPrinterWriteError("Не удалось подключиться к принтеру");
  const characteristic = await findWritableCharacteristic(server);
  await writeChunked(characteristic, commands);
}
