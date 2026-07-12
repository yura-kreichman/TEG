import { UAParser } from "ua-parser-js";

// Колонки "устройство"/"браузер" в журнале ознакомлений (docs/spec/07-
// instructions.md) — распарсенные один раз при подписании и денормализованные
// на AcknowledgmentRecord, не пересчитываются при каждом рендере таблицы.
export function parseUserAgentLabels(userAgent: string): { deviceLabel: string | null; browserLabel: string | null } {
  const result = new UAParser(userAgent).getResult();

  const deviceParts = [result.device.vendor, result.device.model].filter(Boolean);
  const deviceLabel =
    deviceParts.length > 0
      ? deviceParts.join(" ")
      : (result.os.name ? `${result.os.name}${result.os.version ? ` ${result.os.version}` : ""}` : null);

  const browserLabel = result.browser.name
    ? `${result.browser.name}${result.browser.version ? ` ${result.browser.version.split(".")[0]}` : ""}`
    : null;

  return { deviceLabel, browserLabel };
}
