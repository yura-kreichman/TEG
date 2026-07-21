import type { ZoneSummarySettingsData, DailyCashSummarySettingsData, ShiftCloseSummarySettingsData } from "@/lib/summary-settings";
import type { ZoneSummaryData, DailyCashSummaryData, ShiftCloseSummaryData, InstructionAckData } from "./types";
import { formatDuration, formatLocalTime, formatSummaryDate } from "./format-shared";
import { formatMoney } from "@/lib/format";
import type { Locale } from "@/lib/locales";
import type { Dictionary } from "@/lib/i18n";

// Ярлыки строк письма — из словаря тенанта, тот же принцип, что в
// telegram-format.ts (запрос пользователя 2026-07-16).
type SummaryText = Dictionary["summaryText"];

// Чистые функции построения HTML-писем — тот же принцип, что telegram-format.ts:
// данные + настройки → готовый {subject, html}, без SMTP, без сети.
// День/время — в часовом поясе тенанта, не в сыром UTC (тот же баг, что в
// telegram-format.ts, см. format-shared.ts).

function formatDate(d: Date, timezone: string): string {
  return formatSummaryDate(d, ".", timezone);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface EmailRow {
  label: string;
  value: string;
  bold?: boolean;
}

function wrapEmail(companyName: string, title: string, subtitle: string, rows: EmailRow[], locale: Locale): string {
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
<html lang="${locale}">
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
  companyName: string,
  locale: Locale,
  timezone: string,
  st: SummaryText
): { subject: string; html: string } {
  const subject = `${st.zoneSummarySubject} · ${data.zoneName} · ${formatDate(data.occurredAt, timezone)}`;
  const rows: EmailRow[] = [];

  if (data.accountingMode === "cash_only") {
    rows.push({ label: st.cashOnly, value: formatMoney(data.cashAmount, locale), bold: true });
  } else {
    if (data.isGameRoom) {
      if (settings.showReadings) {
        rows.push({ label: st.launchesCountLabel, value: String(data.gameRoomLaunchCount ?? 0) });
        rows.push({ label: st.launchesTimeLabel, value: formatDuration(data.gameRoomTotalMinutes ?? 0) });
      }
    } else if (data.accountingMode === "launches") {
      // "Пуски" — без времени, тапы мгновенные (запрос пользователя
      // 2026-07-17), в отличие от isGameRoom ("Прибывания") выше.
      if (settings.showReadings) {
        rows.push({ label: st.launchesCountLabel, value: String(data.gameRoomLaunchCount ?? 0) });
      }
    } else if (data.accountingMode === "tickets") {
      // Билеты (docs/spec/10-tickets.md) — ни показаний, ни разреза по
      // активу (заказ может содержать разные активы сразу), только счётчики
      // заказов/билетов, тот же принцип, что formatTicketsLine в
      // telegram-format.ts.
      if (settings.showReadings) {
        rows.push({ label: st.ticketsOrdersCountLabel, value: String(data.ticketsOrdersCount ?? 0) });
        rows.push({ label: st.ticketsSoldCountLabel, value: String(data.ticketsCount ?? 0) });
      }
    } else if (settings.showReadings || settings.showDelta) {
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
    if (settings.showCash) {
      rows.push({
        label: `${st.cash} / ${st.mobile}`,
        value: `${formatMoney(data.cashAmount, locale)} / ${formatMoney(data.mobileAmount, locale)}`,
      });
      // Справочно, НЕ в кассе выше — уже получена раньше, при пополнении
      // абонемента (запрос пользователя 2026-07-17: "во всех отчётах и
      // сводках должны быть правильные цифры", "добавить Абонемент").
      if (data.abonementAmount > 0) {
        rows.push({ label: st.abonement, value: formatMoney(data.abonementAmount, locale) });
      }
    }
    if (settings.showCalc) rows.push({ label: st.calculated, value: formatMoney(data.calculatedRevenue, locale) });
    if (settings.showDiff) {
      rows.push({
        label: st.difference,
        value: `${data.difference > 0 ? "+" : ""}${formatMoney(data.difference, locale)}`,
        bold: true,
      });
    }
    if (settings.showReturns) rows.push({ label: st.returns, value: String(data.returnsCount) });
  }
  if (settings.showOperator) rows.push({ label: st.operatorLabel, value: data.operatorName });

  return {
    subject,
    html: wrapEmail(companyName, `${st.zoneSummarySubject} «${data.zoneName}»`, formatDate(data.occurredAt, timezone), rows, locale),
  };
}

export function formatDailyCashSummaryEmail(
  data: DailyCashSummaryData,
  settings: DailyCashSummarySettingsData,
  companyName: string,
  locale: Locale,
  timezone: string,
  st: SummaryText
): { subject: string; html: string } {
  const subject = `${st.dailyCashSubject} · ${data.pointName} · ${formatDate(data.businessDate, timezone)}`;
  const total = data.cashAmount + data.mobileAmount - data.expenses;
  const rows: EmailRow[] = [];

  if (settings.showCash) {
    rows.push({
      label: `${st.cash} / ${st.mobile}`,
      value: `${formatMoney(data.cashAmount, locale)} / ${formatMoney(data.mobileAmount, locale)}`,
    });
    if (data.abonementAmount > 0) {
      rows.push({ label: st.abonement, value: formatMoney(data.abonementAmount, locale) });
    }
    // Продажа абонементов — реальные деньги, отдельно от абонемента-как-
    // способа-оплаты выше (запрос пользователя 2026-07-18: тот же разрыв,
    // что уже закрыт в Итогах дня/Отчётах/Остатках).
    if (data.abonementSold.cash + data.abonementSold.mobile > 0) {
      rows.push({ label: st.abonementSold, value: formatMoney(data.abonementSold.cash + data.abonementSold.mobile, locale) });
    }
  }
  if (settings.showExpenses) {
    rows.push({ label: st.expenses, value: formatMoney(data.expenses, locale) });
    // Сразу после Расходов (запрос пользователя 2026-07-17), тот же
    // тумблер — обе строки об одном: деньги, ушедшие из кассы за день, но
    // не Расход бизнеса в бухгалтерском смысле.
    rows.push({ label: st.bonusesAndAdvances, value: formatMoney(data.bonusesAndAdvances, locale) });
  }
  rows.push({ label: st.totalFull, value: formatMoney(total, locale), bold: true });
  if (settings.showZoneBreakdown) {
    for (const z of data.zoneBreakdown) {
      const value =
        z.abonementAmount > 0
          ? `${formatMoney(z.revenue, locale)} (+${formatMoney(z.abonementAmount, locale)})`
          : formatMoney(z.revenue, locale);
      rows.push({ label: z.zoneName, value });
    }
  }
  if (settings.showCashOnHand) rows.push({ label: st.cashOnHand, value: formatMoney(data.cashOnHand, locale) });

  return {
    subject,
    html: wrapEmail(companyName, `${st.dailyCashSubject} · ${data.pointName}`, formatDate(data.businessDate, timezone), rows, locale),
  };
}

export function formatShiftCloseSummaryEmail(
  data: ShiftCloseSummaryData,
  settings: ShiftCloseSummarySettingsData,
  companyName: string,
  locale: Locale,
  timezone: string,
  st: SummaryText
): { subject: string; html: string } {
  const subject = `${st.shiftCloseSubject} · ${data.operatorName} · ${formatDate(data.startAt, timezone)}`;
  const rows: EmailRow[] = [];

  if (settings.showPeriod) rows.push({ label: st.period, value: `${formatLocalTime(data.startAt, timezone)} – ${formatLocalTime(data.endAt, timezone)}` });
  if (settings.showHours) rows.push({ label: st.hoursWorked, value: formatDuration(data.minutes) });
  // Аванс: 0 показывается всегда при включённом тумблере (запрос
  // пользователя 2026-07-18: "если сотрудник не брал Аванс, то надо
  // выводить Аванс: 0"), в отличие от Премии ниже.
  if (settings.showAdvance) rows.push({ label: st.advance, value: formatMoney(data.advanceAmount, locale) });
  if (settings.showBonus && data.bonusAmount > 0) rows.push({ label: st.bonus, value: formatMoney(data.bonusAmount, locale) });
  if (settings.showTotal) rows.push({ label: st.toPayOutFull, value: formatMoney(data.toPayOut, locale), bold: true });

  return {
    subject,
    html: wrapEmail(companyName, `${st.shiftWordCap} · ${data.operatorName}`, formatDate(data.startAt, timezone), rows, locale),
  };
}

export function formatInstructionAckEmail(
  data: InstructionAckData,
  companyName: string,
  locale: Locale,
  st: SummaryText,
  readingTimeLabel: string,
  minutesShort: string,
  instructionAckTitle: string
): { subject: string; html: string } {
  const subject = `${st.instructionAckSubject} · ${data.instructionTitle}`;
  const rows: EmailRow[] = [
    { label: st.instructionAckEmailWho, value: data.fullName, bold: true },
    { label: readingTimeLabel, value: `${data.readingMinutes} ${minutesShort}` },
  ];
  return { subject, html: wrapEmail(companyName, data.instructionTitle, instructionAckTitle, rows, locale) };
}
