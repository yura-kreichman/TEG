import type { ZoneSummarySettingsData, DailyCashSummarySettingsData, ShiftCloseSummarySettingsData } from "@/lib/summary-settings";
import type { ZoneSummaryData, DailyCashSummaryData, ShiftCloseSummaryData, InstructionAckData } from "./types";
import { formatDuration, formatSummaryDate, formatUtcTime } from "./format-shared";
import { colorTagToEmoji } from "@/lib/color-tag";

// fullName приходит с публичной страницы подписания (docs/spec/07-
// instructions.md) — единственный текст во всём этом файле, полученный от
// неаутентифицированного внешнего посетителя, а не введённый владельцем
// внутри приложения. sendChatMessage шлёт с parse_mode "HTML" — без
// экранирования "<"/"&" в имени сломанная разметка уронёт всю отправку 400-й
// ошибкой Bot API (не XSS — Telegram не браузер — но реальный сбой уведомления).
function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Чистые функции построения текста Telegram-сводок — без сети, без БД, без
// Bot API. Каждая — вход "данные + настройки", выход "готовый текст". Это то,
// что позволяет проверять формат сообщений скриптом, не отправляя реальных
// сообщений в Telegram (см. верификацию Telegram-сводки модуля Смен).
//
// Валюта — никогда не хардкодим символ (feedback_no_hardcoded_currency):
// голые .toFixed(2). День/время — UTC, как и весь остальной server-side
// day-boundary код в проекте (см. business-day.ts).

function formatDate(d: Date): string {
  return formatSummaryDate(d, "/");
}

// compact (фидбек пользователя 2026-07-12, скриншот с примером) — общий
// принцип для ВСЕХ трёх сводок: никаких пустых строк-отступов между
// секциями, всё что можно — на одну строку через короткий разделитель, а
// списки переменной длины (показания по активам, разбивка по зонам) — в
// колонки с именем, обрезанным до 5 символов. Цель — сообщение целиком
// умещается по ширине экрана телефона, без переноса строк.
const COMPACT_NAME_WIDTH = 5;
const COMPACT_GRID_SEP = " | ";
// Примерный бюджет ширины строки внутри <code>-блока на современном
// телефоне (фидбек пользователя 2026-07-12: "столько значений, сколько
// вмещается на экран") — не точный пиксельный расчёт (шрифт/ширина экрана
// у Telegram варьируются), а безопасная эвристика: ~40-42 моноширинных
// символа стабильно помещаются в один непереносимый ряд на большинстве
// современных телефонов (390-430px CSS-ширина) при дефолтном размере шрифта
// Telegram. Число колонок подбирается под эту ширину динамически — чем
// длиннее значения (например, суммы с копейками), тем меньше колонок в ряд.
const COMPACT_GRID_TARGET_WIDTH = 42;

function formatCompactGrid(items: { label: string; value: string }[]): string {
  if (items.length === 0) return "";
  const valueWidth = Math.max(4, ...items.map((it) => it.value.length));
  const cellWidth = COMPACT_NAME_WIDTH + 2 + valueWidth; // +2 — ": "
  const cols = Math.max(
    1,
    Math.min(
      items.length,
      Math.floor((COMPACT_GRID_TARGET_WIDTH + COMPACT_GRID_SEP.length) / (cellWidth + COMPACT_GRID_SEP.length))
    )
  );
  const cells = items.map(
    (it) => `${it.label.slice(0, COMPACT_NAME_WIDTH).padEnd(COMPACT_NAME_WIDTH)}: ${it.value.padStart(valueWidth)}`
  );
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    rows.push(cells.slice(i, i + cols).join(COMPACT_GRID_SEP));
  }
  return rows.join("\n");
}

// Активу с несколькими тарифами (до 2 на зону, docs/spec/01-counters.md)
// соответствует несколько строк подряд с одинаковым assetName — голое
// имя актива для обеих было бы неразличимо ("Форму: 3132 | Форму: 429").
// Фидбек пользователя 2026-07-12: различать суффиксом-номером тарифа
// ("Форм1"/"Форм2"), обрезая имя актива до 4 символов + 1 цифра = 5 (лимит
// компактной колонки), а не полным/частичным именем тарифа. Один тариф на
// актив — суффикс не нужен, имя обрезается как обычно до 5 символов.
function compactAssetLabel(readings: ZoneSummaryData["readings"], index: number): string {
  const assetName = readings[index].assetName;
  const sameAsset = readings.filter((r) => r.assetName === assetName);
  if (sameAsset.length <= 1) return assetName;
  const occurrence = readings.slice(0, index + 1).filter((r) => r.assetName === assetName).length;
  return `${assetName.slice(0, COMPACT_NAME_WIDTH - 1)}${occurrence}`;
}

// Разница считается "нормальной" только при 0 — зелёная галочка на
// ненулевой разнице вводит в заблуждение (фидбек пользователя 2026-07-12:
// "это не нормально, чтобы была зелёная галочка"). ⚠️ на любое ненулевое
// значение, в любую сторону — и недостача, и избыток одинаково "не сошлось".
function diffEmoji(difference: number): string {
  return difference === 0 ? "✅" : "⚠️";
}

// Имя оператора — в первой строке сводки, рядом с зоной (фидбек пользователя
// 2026-07-12: "должно быть в первой строке, где написано Машинки"), а не
// отдельной строкой в конце, как раньше. Цветовой квадрат — см. ShiftCloseSummaryData.
// zoneEmoji — Zone.telegramEmoji, выбирается владельцем отдельно от SVG-иконки
// (Telegram не отрисует произвольный SVG инлайн); 🏁 — запасной вариант.
function zoneHeader(data: ZoneSummaryData, showOperator: boolean): string {
  const colorPrefix = colorTagToEmoji(data.operatorColorTag);
  const operatorBit = showOperator
    ? ` · ${colorPrefix ? `${colorPrefix} ` : ""}${data.operatorName}`
    : "";
  return `${data.zoneEmoji ?? "🏁"} <b>${data.zoneName.toUpperCase()}${operatorBit} · ${formatDate(data.occurredAt)}</b>`;
}

export function formatZoneSummaryTelegram(data: ZoneSummaryData, settings: ZoneSummarySettingsData): string {
  if (settings.compact) {
    const parts: string[] = [zoneHeader(data, settings.showOperator)];

    if (data.accountingMode === "cash_only") {
      parts.push(`💵 Касса: <b>${data.cashAmount.toFixed(2)}</b>`);
    } else {
      if (settings.showReadings && data.readings.length > 0) {
        const grid = formatCompactGrid(
          data.readings.map((r, i) => ({ label: compactAssetLabel(data.readings, i), value: String(r.reading) }))
        );
        parts.push(`<blockquote><code>${grid}</code></blockquote>`);
      }

      if (settings.showCash || settings.showCalc) {
        // Нал.+Безнал вместе ("Касс"), не один cashAmount — иначе строка не
        // сходится с Разн. (та считается от суммы обоих, как и на сервере,
        // см. submit-results/route.ts: actualCash = cashAmount + mobileAmount).
        // Фидбек пользователя 2026-07-12: "Касса 1345, а по счётчикам 1715 —
        // разница должна быть -370", но показанная compact-строка сравнивала
        // только cashAmount, без mobileAmount — расхождение было в отображении,
        // не в расчёте разницы (та всегда считалась правильно).
        const actualCash = data.cashAmount + data.mobileAmount;
        const cmp = actualCash < data.calculatedRevenue ? "<" : actualCash > data.calculatedRevenue ? ">" : "=";
        const bits: string[] = [];
        if (settings.showCash) bits.push(`💵 Касс: <b>${actualCash.toFixed(2)}</b>`);
        if (settings.showCash && settings.showCalc) bits.push(cmp);
        if (settings.showCalc) bits.push(`🧮 Счёт: <b>${data.calculatedRevenue.toFixed(2)}</b>`);
        parts.push(bits.join("  "));
      }
      if (settings.showDiff || settings.showReturns) {
        const bits: string[] = [];
        if (settings.showDiff) {
          const sign = data.difference > 0 ? "+" : "";
          bits.push(`${diffEmoji(data.difference)} Разн.: <b>${sign}${data.difference.toFixed(2)}</b>`);
        }
        if (settings.showDiff && settings.showReturns) bits.push("—");
        if (settings.showReturns) bits.push(`🔄 Возвр.: <b>${data.returnsCount}</b>`);
        parts.push(bits.join("  "));
      }
    }

    return parts.join("\n");
  }

  const lines: string[] = [zoneHeader(data, settings.showOperator)];

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
        lines.push(`${diffEmoji(data.difference)} Разница: <b>${sign}${data.difference.toFixed(2)}</b>`);
      }
      if (settings.showReturns) lines.push(`↩️ Возвраты/тест: <b>${data.returnsCount}</b>`);
    }
  }

  return lines.join("\n");
}

export function formatDailyCashSummaryTelegram(
  data: DailyCashSummaryData,
  settings: DailyCashSummarySettingsData
): string {
  const total = data.cashAmount + data.mobileAmount - data.expenses;

  if (settings.compact) {
    const parts: string[] = [`💰 <b>КАССА · ${data.pointName} · ${formatDate(data.businessDate)}</b>`];

    if (data.forcedIncomplete) parts.push("⚠️ Принудительно — не все данные могли поступить");

    if (settings.showCash) {
      parts.push(`💵 Нал.: <b>${data.cashAmount.toFixed(2)}</b>  📱 Безнал.: <b>${data.mobileAmount.toFixed(2)}</b>`);
    }
    if (settings.showExpenses) parts.push(`🧾 Расх.: ${data.expenses.toFixed(2)}`);
    parts.push(`Σ Итог: <b>${total.toFixed(2)}</b>`);

    if (settings.showZoneBreakdown && data.zoneBreakdown.length > 0) {
      const grid = formatCompactGrid(data.zoneBreakdown.map((z) => ({ label: z.zoneName, value: z.revenue.toFixed(2) })));
      parts.push(`<blockquote><code>${grid}</code></blockquote>`);
    }

    if (settings.showCashOnHand) parts.push(`📦 Ост.: ${data.cashOnHand.toFixed(2)}`);

    return parts.join("\n");
  }

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
  // Цветовой квадрат перед именем оператора (фидбек пользователя 2026-07-12) —
  // и в компактном, и в обычном виде; null (метка не задана) — без эмодзи.
  const colorPrefix = colorTagToEmoji(data.operatorColorTag);
  const operatorLabel = colorPrefix ? `${colorPrefix} ${data.operatorName}` : data.operatorName;

  if (settings.compact) {
    // Все включённые поля сводятся на одну строку через " · " вместо
    // одной строки на поле — та же цель, что у compact в Zone/Daily Cash
    // Summary: сообщение целиком в ширину экрана. "Итог" сокращён до
    // "Бал." (баланс) — фидбек пользователя 2026-07-12.
    const parts: string[] = [];
    if (settings.showPeriod) parts.push(`🕐 ${formatUtcTime(data.startAt)}–${formatUtcTime(data.endAt)}`);
    if (settings.showHours) parts.push(`⏱ ${formatDuration(data.minutes)}`);
    if (settings.showAdvance && data.advanceAmount > 0) parts.push(`💸 Аванс: ${data.advanceAmount.toFixed(2)}`);
    if (settings.showBonus && data.bonusAmount > 0) parts.push(`🏆 Прем.: ${data.bonusAmount.toFixed(2)}`);
    if (settings.showTotal) parts.push(`💰 Бал.: <b>${data.toPayOut.toFixed(2)}</b>`);

    const header = `<b>${operatorLabel} · ${formatDate(data.startAt)}</b>`;
    return parts.length > 0 ? `${header}\n${parts.join(" · ")}` : header;
  }

  const lines: string[] = [`<b>${operatorLabel} · смена ${formatDate(data.startAt)}</b>`, ""];

  if (settings.showPeriod) lines.push(`🕐 Период: ${formatUtcTime(data.startAt)} – ${formatUtcTime(data.endAt)}`);
  if (settings.showHours) lines.push(`⏱ Отработано: ${formatDuration(data.minutes)}`);
  if (settings.showAdvance && data.advanceAmount > 0) lines.push(`💸 Аванс: ${data.advanceAmount.toFixed(2)}`);
  if (settings.showBonus && data.bonusAmount > 0) lines.push(`🏆 Премия: ${data.bonusAmount.toFixed(2)}`);
  if (settings.showTotal) lines.push(`💰 К выдаче: <b>${data.toPayOut.toFixed(2)}</b>`);

  return lines.join("\n");
}

export function formatInstructionAckTelegram(data: InstructionAckData): string {
  const name = escapeTelegramHtml(data.fullName);
  const title = escapeTelegramHtml(data.instructionTitle);
  return `✅ <b>${name}</b> ознакомился с инструкцией «${title}» за ${data.readingMinutes} мин.`;
}
