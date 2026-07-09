import type { ZoneSummarySettingsData, DailyCashSummarySettingsData, ShiftCloseSummarySettingsData } from "@/lib/summary-settings";
import type { ZoneSummaryData, DailyCashSummaryData, ShiftCloseSummaryData } from "./types";

// Чистые функции построения текста Telegram-сводок — без сети, без БД, без
// Bot API. Каждая — вход "данные + настройки", выход "готовый текст". Это то,
// что позволяет проверять формат сообщений скриптом, не отправляя реальных
// сообщений в Telegram (см. верификацию Telegram-сводки модуля Смен).
//
// Валюта — никогда не хардкодим символ (feedback_no_hardcoded_currency):
// голые .toFixed(2). День/время — UTC, как и весь остальной server-side
// day-boundary код в проекте (см. business-day.ts).

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const weekday = WEEKDAYS[(d.getUTCDay() + 6) % 7];
  return `${day}/${month} (${weekday})`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function formatZoneSummaryTelegram(data: ZoneSummaryData, settings: ZoneSummarySettingsData): string {
  const lines: string[] = [`🏁 <b>${data.zoneName.toUpperCase()} · ${formatDate(data.occurredAt)}</b>`];

  if (data.accountingMode === "cash_only") {
    lines.push("", `💵 Касса: <b>${data.cashAmount.toFixed(2)}</b>`);
  } else {
    if (settings.showReadings || settings.showDelta) {
      // Выровнено в столбик (фидбек пользователя 2026-07-09) — внутри <code>
      // моноширинный шрифт, поэтому паддинг пробелами реально работает как
      // колонки. Подпись дополняется пробелами до общей ширины, показание —
      // до 4 знаков (счётчик 4-разрядный, см. docs/spec/01-counters.md).
      const labelFor = (r: ZoneSummaryData["readings"][number]) => `${r.assetName} · ${r.tariffName}:`;
      const labelWidth = Math.max(...data.readings.map((r) => labelFor(r).length));
      const readingRows = data.readings.map((r) => {
        let row = labelFor(r).padEnd(labelWidth + 1);
        if (settings.showReadings) row += String(r.reading).padStart(4);
        if (settings.showReadings && settings.showDelta) row += " ";
        if (settings.showDelta) row += `(+${r.delta})`;
        return row;
      });
      // Цитата + code (фидбек пользователя 2026-07-09) — Telegram Bot API
      // поддерживает <blockquote> с вложенным <code>, многострочно через \n.
      lines.push("", `<blockquote><code>${readingRows.join("\n")}</code></blockquote>`);
    }

    if (settings.showCash || settings.showCalc || settings.showDiff || settings.showReturns) {
      lines.push("");
      if (settings.showCash) {
        lines.push(
          `💵 Нал.: <b>${data.cashAmount.toFixed(2)}</b> · 📱 Безнал.: <b>${data.mobileAmount.toFixed(2)}</b>`
        );
      }
      if (settings.showCalc) lines.push(`🧮 По счётчику: <b>${data.calculatedRevenue.toFixed(2)}</b>`);
      if (settings.showDiff) {
        const sign = data.difference > 0 ? "+" : "";
        lines.push(`⚖️ Разница: <b>${sign}${data.difference.toFixed(2)}</b>`);
      }
      if (settings.showReturns) lines.push(`↩️ Возвраты/тест: <b>${data.returnsCount}</b>`);
    }
  }

  if (settings.showOperator) {
    lines.push("", `👤 Оператор: ${data.operatorName}`);
  }

  return lines.join("\n");
}

export function formatDailyCashSummaryTelegram(
  data: DailyCashSummaryData,
  settings: DailyCashSummarySettingsData
): string {
  const total = data.cashAmount + data.mobileAmount - data.expenses;
  const lines: string[] = [`💰 <b>КАССА · ${data.pointName} · ${formatDate(data.businessDate)}</b>`];

  if (data.forcedIncomplete) {
    lines.push("", "⚠️ Отправлено принудительно по границе дня — не все данные могли поступить.");
  }

  lines.push("");
  if (settings.showCash) {
    lines.push(`💵 Нал.: <b>${data.cashAmount.toFixed(2)}</b> · 📱 Безнал.: <b>${data.mobileAmount.toFixed(2)}</b>`);
  }
  if (settings.showExpenses) lines.push(`🧾 Расходы: ${data.expenses.toFixed(2)}`);
  lines.push(`Σ Итого за день: <b>${total.toFixed(2)}</b>`);

  if (settings.showZoneBreakdown && data.zoneBreakdown.length > 0) {
    const labelWidth = Math.max(...data.zoneBreakdown.map((z) => `${z.zoneName}:`.length));
    const breakdownRows = data.zoneBreakdown.map((z) => `${z.zoneName}:`.padEnd(labelWidth + 1) + z.revenue.toFixed(2));
    lines.push("", `<blockquote><code>${breakdownRows.join("\n")}</code></blockquote>`);
  }

  if (settings.showCashOnHand) {
    lines.push("", `📦 Остаток на точке: ${data.cashOnHand.toFixed(2)}`);
  }

  return lines.join("\n");
}

export function formatShiftCloseSummaryTelegram(
  data: ShiftCloseSummaryData,
  settings: ShiftCloseSummarySettingsData
): string {
  const lines: string[] = [`🕐 <b>${data.operatorName} · смена ${formatDate(data.startAt)}</b>`, ""];

  const fmtTime = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

  if (settings.showPeriod) lines.push(`🕐 Период: ${fmtTime(data.startAt)} – ${fmtTime(data.endAt)}`);
  if (settings.showHours) lines.push(`⏱ Отработано: ${formatDuration(data.minutes)}`);
  if (settings.showAdvance && data.advanceAmount > 0) lines.push(`💸 Аванс: ${data.advanceAmount.toFixed(2)}`);
  if (settings.showBonus && data.bonusAmount > 0) lines.push(`🏆 Премия: ${data.bonusAmount.toFixed(2)}`);
  if (settings.showTotal) lines.push(`💰 К выдаче: <b>${data.toPayOut.toFixed(2)}</b>`);

  return lines.join("\n");
}
