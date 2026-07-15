import type { ZoneSummarySettingsData, DailyCashSummarySettingsData, ShiftCloseSummarySettingsData } from "@/lib/summary-settings";
import type { ZoneSummaryData, DailyCashSummaryData, ShiftCloseSummaryData, InstructionAckData } from "./types";
import { formatAmount, formatDuration, formatSummaryDate, formatUtcTime } from "./format-shared";

// Чистые функции построения HTML-писем — тот же принцип, что telegram-format.ts:
// данные + настройки → готовый {subject, html}, без SMTP, без сети.

function formatDate(d: Date): string {
  return formatSummaryDate(d, ".");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface EmailRow {
  label: string;
  value: string;
  bold?: boolean;
}

function wrapEmail(companyName: string, title: string, subtitle: string, rows: EmailRow[]): string {
  const rowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 0;color:#5C6662;font-size:14px;">${escapeHtml(r.label)}</td>
        <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-size:14px;${r.bold ? "font-weight:700;color:#1B1F1D;" : "color:#1B1F1D;"}">${escapeHtml(r.value)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#F6F7F5;font-family:system-ui,sans-serif;color:#1B1F1D;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:24px;">
    <p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9AA39F;margin:0 0 4px;">${escapeHtml(companyName)}</p>
    <h1 style="font-size:20px;font-weight:800;margin:0 0 4px;">${escapeHtml(title)}</h1>
    <p style="font-size:13px;color:#5C6662;margin:0 0 16px;">${escapeHtml(subtitle)}</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #E8EBE8;">
      ${rowsHtml}
    </table>
  </div>
</body>
</html>`;
}

export function formatZoneSummaryEmail(
  data: ZoneSummaryData,
  settings: ZoneSummarySettingsData,
  companyName: string
): { subject: string; html: string } {
  const subject = `Сводка по зоне · ${data.zoneName} · ${formatDate(data.occurredAt)}`;
  const rows: EmailRow[] = [];

  if (data.accountingMode === "cash_only") {
    rows.push({ label: "Касса", value: formatAmount(data.cashAmount), bold: true });
  } else {
    if (settings.showReadings || settings.showDelta) {
      for (const r of data.readings) {
        const value = [
          settings.showReadings ? String(r.reading) : null,
          settings.showDelta ? `(+${r.delta})` : null,
        ]
          .filter(Boolean)
          .join(" ");
        rows.push({ label: `${r.assetName} · ${r.tariffName}`, value });
      }
    }
    if (settings.showCash) rows.push({ label: "Наличные / Безнал", value: `${formatAmount(data.cashAmount)} / ${formatAmount(data.mobileAmount)}` });
    if (settings.showCalc) rows.push({ label: "По счётчику", value: formatAmount(data.calculatedRevenue) });
    if (settings.showDiff) rows.push({ label: "Разница", value: `${data.difference > 0 ? "+" : ""}${formatAmount(data.difference)}`, bold: true });
    if (settings.showReturns) rows.push({ label: "Возвраты/тест", value: String(data.returnsCount) });
  }
  if (settings.showOperator) rows.push({ label: "Оператор", value: data.operatorName });

  return { subject, html: wrapEmail(companyName, `Сводка по зоне «${data.zoneName}»`, formatDate(data.occurredAt), rows) };
}

export function formatDailyCashSummaryEmail(
  data: DailyCashSummaryData,
  settings: DailyCashSummarySettingsData,
  companyName: string
): { subject: string; html: string } {
  const subject = `Касса за день · ${data.pointName} · ${formatDate(data.businessDate)}`;
  const total = data.cashAmount + data.mobileAmount - data.expenses;
  const rows: EmailRow[] = [];

  if (settings.showCash) rows.push({ label: "Наличные / Безнал", value: `${formatAmount(data.cashAmount)} / ${formatAmount(data.mobileAmount)}` });
  if (settings.showExpenses) rows.push({ label: "Расходы", value: formatAmount(data.expenses) });
  rows.push({ label: "Итого за день", value: formatAmount(total), bold: true });
  if (settings.showZoneBreakdown) {
    for (const z of data.zoneBreakdown) rows.push({ label: z.zoneName, value: formatAmount(z.revenue) });
  }
  if (settings.showCashOnHand) rows.push({ label: "Остаток на точке", value: formatAmount(data.cashOnHand) });

  return { subject, html: wrapEmail(companyName, `Касса за день · ${data.pointName}`, formatDate(data.businessDate), rows) };
}

export function formatShiftCloseSummaryEmail(
  data: ShiftCloseSummaryData,
  settings: ShiftCloseSummarySettingsData,
  companyName: string
): { subject: string; html: string } {
  const subject = `Закрытие смены · ${data.operatorName} · ${formatDate(data.startAt)}`;
  const rows: EmailRow[] = [];

  if (settings.showPeriod) rows.push({ label: "Период", value: `${formatUtcTime(data.startAt)} – ${formatUtcTime(data.endAt)}` });
  if (settings.showHours) rows.push({ label: "Отработано", value: formatDuration(data.minutes) });
  if (settings.showAdvance && data.advanceAmount > 0) rows.push({ label: "Аванс", value: formatAmount(data.advanceAmount) });
  if (settings.showBonus && data.bonusAmount > 0) rows.push({ label: "Премия", value: formatAmount(data.bonusAmount) });
  if (settings.showTotal) rows.push({ label: "К выдаче", value: formatAmount(data.toPayOut), bold: true });

  return { subject, html: wrapEmail(companyName, `Смена · ${data.operatorName}`, formatDate(data.startAt), rows) };
}

export function formatInstructionAckEmail(data: InstructionAckData, companyName: string): { subject: string; html: string } {
  const subject = `Ознакомление · ${data.instructionTitle}`;
  const rows: EmailRow[] = [
    { label: "Кто", value: data.fullName, bold: true },
    { label: "Время чтения", value: `${data.readingMinutes} мин.` },
  ];
  return { subject, html: wrapEmail(companyName, data.instructionTitle, "Инструктаж пройден", rows) };
}
