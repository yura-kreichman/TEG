import type { ZoneSummarySettingsData, DailyCashSummarySettingsData, ShiftCloseSummarySettingsData } from "@/lib/summary-settings";
import type { ZoneSummaryData, DailyCashSummaryData, ShiftCloseSummaryData, InstructionAckData } from "./types";
import { formatAmount, formatDuration, formatSummaryDate, formatUtcTime } from "./format-shared";
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
// голые числа. Суммы — целые (formatAmount, без копеек, запрос пользователя
// 2026-07-14). День/время — UTC, как и весь остальной server-side
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
const COMPACT_GRID_SEP = " │ ";
// Примерный бюджет ширины строки внутри <code>-блока на современном
// телефоне (фидбек пользователя 2026-07-12: "столько значений, сколько
// вмещается на экран") — не точный пиксельный расчёт (шрифт/ширина экрана
// у Telegram варьируются), а безопасная эвристика: ~40-42 моноширинных
// символа стабильно помещаются в один непереносимый ряд на большинстве
// современных телефонов (390-430px CSS-ширина) при дефолтном размере шрифта
// Telegram. Число колонок подбирается под эту ширину динамически — чем
// длиннее значения (например, суммы с копейками), тем меньше колонок в ряд.
const COMPACT_GRID_TARGET_WIDTH = 42;

// Обрезка "4 первых символа + 1 последний" (запрос пользователя 2026-07-14,
// скриншот: "Гоночная 1"/"Гоночная 2" обе обрезались до "Гоноч" — разница
// была ровно за пределами первых 5 символов, показания читались как один
// и тот же актив). Последний символ имени почти всегда и есть отличающая
// часть в реальных названиях ("Гоночная 1"/"Гоночная 2", "Картинг 1"/
// "Картинг 2") — простой slice(0,5) этого не видит, а 4+1 видит.
function truncateLabel(name: string): string {
  if (name.length <= COMPACT_NAME_WIDTH) return name;
  return `${name.slice(0, COMPACT_NAME_WIDTH - 1)}${name.slice(-1)}`;
}

// В цитате (blockquote) — не больше 2 значений в строке (запрос пользователя
// 2026-07-14), даже если по ширине формально влезло бы больше — короткие
// суммы/показания раньше паковались по 3, из-за чего колонки визуально не
// выравнивались со строкой ниже (та же сетка, но с другим количеством
// значений). Меньше колонок — предсказуемее выравнивание, чем чуть плотнее
// упаковка.
const COMPACT_GRID_MAX_COLS = 2;

// Заголовок "Кассы за день" — название точки своей отдельной первой строкой,
// без обрезки (запрос пользователя 2026-07-14: раньше точка делила строку с
// "КАССА" и датой и обрезалась до 14 символов, чтобы уместиться — теперь она
// просто на отдельной строке, места сколько угодно). Если у тенанта всего
// одна точка — строка вообще не показывается (data.showPointName, считается
// в daily-cash-data.ts по количеству точек тенанта) — само собой разумеется,
// какая это точка, называть её незачем.
function dailyCashHeaderLines(data: DailyCashSummaryData): string[] {
  const lines: string[] = [];
  if (data.showPointName) lines.push(`<b>${data.pointName}</b>`);
  lines.push(`💰 <b>КАССА · ${formatDate(data.businessDate)}</b>`);
  return lines;
}

function formatCompactGrid(items: { label: string; value: string }[]): string {
  if (items.length === 0) return "";
  const valueWidth = Math.max(4, ...items.map((it) => it.value.length));
  const cellWidth = COMPACT_NAME_WIDTH + 2 + valueWidth; // +2 — ": "
  const cols = Math.max(
    1,
    Math.min(
      COMPACT_GRID_MAX_COLS,
      items.length,
      Math.floor((COMPACT_GRID_TARGET_WIDTH + COMPACT_GRID_SEP.length) / (cellWidth + COMPACT_GRID_SEP.length))
    )
  );
  const cells = items.map(
    (it) => `${truncateLabel(it.label).padEnd(COMPACT_NAME_WIDTH)}: ${it.value.padStart(valueWidth)}`
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
// ("Форм1"/"Форм2"). Обрезка НЕ через truncateLabel здесь: имена совпадают
// дословно (это один и тот же актив, две строки — по тарифу на строку),
// 4+1 от одинаковой строки дал бы одинаковый результат для обеих — нужен
// именно номер вхождения, а не последний символ имени.
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
      parts.push(`💵 Касса: <b>${formatAmount(data.cashAmount)}</b>`);
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
        if (settings.showCash) bits.push(`💵 Касс: <b>${formatAmount(actualCash)}</b>`);
        if (settings.showCash && settings.showCalc) bits.push(cmp);
        if (settings.showCalc) bits.push(`🧮 Счёт: <b>${formatAmount(data.calculatedRevenue)}</b>`);
        parts.push(bits.join("  "));
      }
      if (settings.showDiff || settings.showReturns) {
        const bits: string[] = [];
        if (settings.showDiff) {
          const sign = data.difference > 0 ? "+" : "";
          bits.push(`${diffEmoji(data.difference)} Разн.: <b>${sign}${formatAmount(data.difference)}</b>`);
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
    lines.push("", `💵 Касса: <b>${formatAmount(data.cashAmount)}</b>`);
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
          `💵 Нал.: <b>${formatAmount(data.cashAmount)}</b> · 📱 Безнал.: <b>${formatAmount(data.mobileAmount)}</b>`
        );
      }
      if (settings.showCalc) lines.push(`🧮 По счётчику: <b>${formatAmount(data.calculatedRevenue)}</b>`);
      if (settings.showDiff) {
        const sign = data.difference > 0 ? "+" : "";
        lines.push(`${diffEmoji(data.difference)} Разница: <b>${sign}${formatAmount(data.difference)}</b>`);
      }
      if (settings.showReturns) lines.push(`↩️ Возвраты/тест: <b>${data.returnsCount}</b>`);
    }
  }

  return lines.join("\n");
}

// Разбивка по зонам — полными именами, по одной зоне в строке, без "|"
// (запрос пользователя 2026-07-14: "названия зон не сокращай и пиши их в
// ряд, без символа разделения, как в обычном режиме") — в отличие от
// показаний по активам (formatCompactGrid), зон на точке обычно немного и
// имена короче, обрезка/упаковка в колонки тут не нужна даже в compact;
// теперь этот блок буквально одинаков в обоих режимах.
function formatZoneBreakdownRows(zoneBreakdown: DailyCashSummaryData["zoneBreakdown"]): string {
  const labelWidth = Math.max(...zoneBreakdown.map((z) => `${z.zoneName}:`.length));
  return zoneBreakdown.map((z) => `${z.zoneName}:`.padEnd(labelWidth + 1) + formatAmount(z.revenue)).join("\n");
}

export function formatDailyCashSummaryTelegram(
  data: DailyCashSummaryData,
  settings: DailyCashSummarySettingsData
): string {
  const total = data.cashAmount + data.mobileAmount - data.expenses;

  if (settings.compact) {
    const parts: string[] = dailyCashHeaderLines(data);

    if (data.forcedIncomplete) parts.push("⚠️ Принудительно — не все данные могли поступить");

    if (settings.showCash) {
      parts.push(`💵 Нал.: <b>${formatAmount(data.cashAmount)}</b>  📱 Безнал.: <b>${formatAmount(data.mobileAmount)}</b>`);
    }
    if (settings.showExpenses) parts.push(`🧾 Расх.: ${formatAmount(data.expenses)}`);

    // Остаток на точке — рядом с Итогом, тем же разделителем " · ", что и
    // везде в compact-режиме (запрос пользователя 2026-07-14: раньше был
    // отдельной строкой в самом низу).
    const totalBits = [`🟰 Итог: <b>${formatAmount(total)}</b>`];
    if (settings.showCashOnHand) totalBits.push(`📦 Ост.: ${formatAmount(data.cashOnHand)}`);
    parts.push(totalBits.join(" · "));

    if (settings.showZoneBreakdown && data.zoneBreakdown.length > 0) {
      parts.push(`<blockquote><code>${formatZoneBreakdownRows(data.zoneBreakdown)}</code></blockquote>`);
    }

    return parts.join("\n");
  }

  const lines: string[] = dailyCashHeaderLines(data);

  if (data.forcedIncomplete) {
    lines.push("", "⚠️ Отправлено принудительно по границе дня — не все данные могли поступить.");
  }

  lines.push("");
  if (settings.showCash) {
    lines.push(`💵 Нал.: <b>${formatAmount(data.cashAmount)}</b> · 📱 Безнал.: <b>${formatAmount(data.mobileAmount)}</b>`);
  }
  if (settings.showExpenses) lines.push(`🧾 Расходы: ${formatAmount(data.expenses)}`);
  lines.push(`🟰 Итого за день: <b>${formatAmount(total)}</b>`);

  if (settings.showZoneBreakdown && data.zoneBreakdown.length > 0) {
    lines.push("", `<blockquote><code>${formatZoneBreakdownRows(data.zoneBreakdown)}</code></blockquote>`);
  }

  if (settings.showCashOnHand) {
    lines.push("", `📦 Остаток на точке: ${formatAmount(data.cashOnHand)}`);
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
    // Не более 2 полей в строке (запрос пользователя 2026-07-14) — раньше
    // все поля шли в одну строку через " · " и переносились по ширине
    // экрана как попало (естественный перенос текста, не по смыслу полей);
    // теперь строки собираются явно, по 2 поля, тем же приёмом, что у
    // Zone/Daily Cash Summary (formatCompactGrid, COMPACT_GRID_MAX_COLS).
    // "Итог" сокращали до "Бал." из-за нехватки места в одну строку (фидбек
    // 2026-07-12) — после перехода на явные строки по 2 поля (2026-07-14,
    // выше) место больше не в дефиците, "Баланс" снова пишется полностью
    // (фидбек 2026-07-14: "здесь это не мешает").
    const parts: string[] = [];
    if (settings.showPeriod) parts.push(`🕐 ${formatUtcTime(data.startAt)}–${formatUtcTime(data.endAt)}`);
    if (settings.showHours) parts.push(`⏱ ${formatDuration(data.minutes)}`);
    if (settings.showAdvance && data.advanceAmount > 0) parts.push(`💸 Аванс: ${formatAmount(data.advanceAmount)}`);
    if (settings.showBonus && data.bonusAmount > 0) parts.push(`🏆 Прем.: ${formatAmount(data.bonusAmount)}`);
    if (settings.showTotal) parts.push(`💰 Баланс: <b>${formatAmount(data.toPayOut)}</b>`);

    const header = `<b>${operatorLabel} · ${formatDate(data.startAt)}</b>`;
    const rows: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      rows.push(parts.slice(i, i + 2).join(" · "));
    }
    return [header, ...rows].join("\n");
  }

  const lines: string[] = [`<b>${operatorLabel} · смена ${formatDate(data.startAt)}</b>`, ""];

  if (settings.showPeriod) lines.push(`🕐 Период: ${formatUtcTime(data.startAt)} – ${formatUtcTime(data.endAt)}`);
  if (settings.showHours) lines.push(`⏱ Отработано: ${formatDuration(data.minutes)}`);
  if (settings.showAdvance && data.advanceAmount > 0) lines.push(`💸 Аванс: ${formatAmount(data.advanceAmount)}`);
  if (settings.showBonus && data.bonusAmount > 0) lines.push(`🏆 Премия: ${formatAmount(data.bonusAmount)}`);
  if (settings.showTotal) lines.push(`💰 К выдаче: <b>${formatAmount(data.toPayOut)}</b>`);

  return lines.join("\n");
}

export function formatInstructionAckTelegram(data: InstructionAckData): string {
  const name = escapeTelegramHtml(data.fullName);
  const title = escapeTelegramHtml(data.instructionTitle);
  return `✅ <b>${name}</b> ознакомился с инструкцией «${title}» за ${data.readingMinutes} мин.`;
}
