import type { ZoneSummarySettingsData, DailyCashSummarySettingsData, ShiftCloseSummarySettingsData } from "@/lib/summary-settings";
import type {
  ZoneSummaryData,
  DailyCashSummaryData,
  DailyCashPending,
  ShiftCloseSummaryData,
  InstructionAckData,
  ExpenseAlertData,
  CollectionAlertData,
} from "./types";
import { formatBusinessDate, formatDuration, formatLocalTime, formatSummaryDate } from "./format-shared";
import { colorTagToEmoji } from "@/lib/color-tag";
import { formatMoney, formatMoneyWithCurrency } from "@/lib/format";
import type { CurrencyCode } from "@/lib/currency";
import type { Locale } from "@/lib/locales";
import type { Dictionary } from "@/lib/i18n";

// Ярлыки ("Касса", "Разница", "Отработано" и т.д.) — из словаря тенанта
// (Dictionary["summaryText"], запрос пользователя 2026-07-16: "переводы
// сводок надо сделать обязательно", включая compact-варианты), не
// захардкожены на русском, как было раньше. Сами данные (имена зон/активов/
// сотрудников) — пользовательский ввод, никогда не переводятся (докс).
type SummaryText = Dictionary["summaryText"];

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
// голые числа через formatMoney (docs/spec/03-design-system.md, "Числа и
// деньги") — единый форматтер на весь проект, тот же, что в кабинете/PWA/
// лендинге, не отдельная логика для сводок. День/время — в часовом поясе
// тенанта (Tenant.timezone), не в сыром UTC сервера (реальный баг, найден
// 2026-07-15 по скриншоту: сдвиг ровно на разницу с UTC — см. format-shared.ts).

function formatDate(d: Date, timezone: string): string {
  return formatSummaryDate(d, "/", timezone);
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
function truncateLabel(name: string, width: number = COMPACT_NAME_WIDTH): string {
  if (name.length <= width) return name;
  return `${name.slice(0, width - 1)}${name.slice(-1)}`;
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
function dailyCashHeaderLines(data: DailyCashSummaryData, timezone: string, st: SummaryText): string[] {
  const lines: string[] = [];
  if (data.showPointName) lines.push(`<b>${escapeTelegramHtml(data.pointName)}</b>`);
  lines.push(`💰 <b>${st.cashOnly.toUpperCase()} · ${formatBusinessDate(data.businessDate, "/")}</b>`);
  return lines;
}

// Пометка "что не закрылось" одной строкой: перечисление того, чего реально не
// хватает, а не намёк на последствие. Пусто — пометки нет вовсе.
//
// Со второго пункта первая буква строчная: это перечисление внутри одной
// строки, а не отдельные предложения. В языках без регистра (հայերեն,
// ქართული) toLocaleLowerCase — пустая операция, ломать нечего.
function pendingNote(pending: DailyCashPending[], st: SummaryText, locale: Locale): string | null {
  if (pending.length === 0) return null;
  const label = (p: DailyCashPending) =>
    p === "openShift" ? st.pendingOpenShift : p === "noSubmissions" ? st.pendingNoSubmissions : st.pendingZones;
  return pending
    .map((p, i) => {
      const text = label(p);
      return i === 0 ? text : text.charAt(0).toLocaleLowerCase(locale) + text.slice(1);
    })
    .join(" · ");
}

// fullNames — не резать имена, отдав им весь свободный остаток строки.
// Включается ТОЛЬКО у Прибываний (обратная связь пользователя 2026-08-04:
// "сокращать названия не надо только у режима Прибывания"): там актив, как
// правило, один, колонка одна, и три четверти ширины простаивают, пока
// "Посещение" превращается в "Посее". У Счётчиков наоборот — активов
// несколько, они идут в две колонки, и обрезка нужна, иначе строка
// переносится; там остаётся прежнее правило "4 первых символа + 1 последний".
function formatCompactGrid(items: { label: string; value: string }[], fullNames = false): string {
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
  // escapeTelegramHtml — ПОСЛЕДНИМ шагом, уже после truncate/padEnd (аудит
  // 2026-07-27): имена активов/тарифов — свободный ввод владельца, "<"/">"/"&"
  // в названии рушили отправку всей сводки (см. escapeTelegramHtml выше).
  // Экранировать раньше нельзя — "&amp;" длиннее "&" на 4 символа, и padEnd,
  // посчитанный по уже экранированной строке, сбил бы визуальное выравнивание
  // колонок в <code>-блоке (Telegram рендерит &amp; обратно в один "&").
  // При fullNames имя получает весь свободный остаток строки, но по-прежнему
  // не вылезает за бюджет ширины — перенос строки в <code>-блоке ломает
  // выравнивание сильнее, чем обрезка.
  const cellBudget = Math.floor((COMPACT_GRID_TARGET_WIDTH - (cols - 1) * COMPACT_GRID_SEP.length) / cols);
  const longestLabel = Math.max(...items.map((it) => it.label.length));
  const nameWidth = fullNames
    ? Math.max(COMPACT_NAME_WIDTH, Math.min(longestLabel, cellBudget - 2 - valueWidth))
    : COMPACT_NAME_WIDTH;

  const cells = items.map((it) =>
    escapeTelegramHtml(`${truncateLabel(it.label, nameWidth).padEnd(nameWidth)}: ${it.value.padStart(valueWidth)}`)
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
// (Telegram не отрисует произвольный SVG инлайн); запасной вариант — 🔢 для
// "По счётчикам" (запрос пользователя 2026-07-18, тот же принцип, что и
// CircuitBoard-иконка этого режима в кабинете), 🏁 для остальных режимов.
// Без дня недели (запрос пользователя 2026-07-15: "Из всех сводок по зонам в
// Телеграм убери название дня недели") — только у зон, Касса за день и
// Закрытие смены день недели по-прежнему показывают через formatDate().
function zoneHeader(data: ZoneSummaryData, showOperator: boolean, timezone: string): string {
  const colorPrefix = colorTagToEmoji(data.operatorColorTag);
  // 👑 после имени — сдачу правил Владелец (требование владельца 2026-08-16:
  // единый маркер правки во всех сообщениях, ровно как иконка-корона в
  // кабинете). Метка сотрудника при этом остаётся: кто сдавал — не меняется.
  const operatorBit = showOperator
    ? ` · ${colorPrefix ? `${colorPrefix} ` : ""}${escapeTelegramHtml(data.operatorName)}${data.editedByOwner ? " 👑" : ""}`
    : "";
  const date = formatSummaryDate(data.occurredAt, "/", timezone, false);
  // Жирным — только название зоны (запрос пользователя 2026-07-17: "во всех
  // сводках с итогами, включая краткие, не надо имя Сотрудника и дату делать
  // жирным") — имя оператора и дата раньше попадали в тот же <b>, что и
  // название зоны, во ВСЕХ форматах (общая zoneHeader и для compact, и для
  // полного вида, оба вызывают её же), теперь вне тега.
  const fallbackEmoji = data.accountingMode === "counters" ? "🔢" : "🏁";
  return `${data.zoneEmoji ?? fallbackEmoji} <b>${escapeTelegramHtml(data.zoneName.toUpperCase())}</b>${operatorBit} · ${date}`;
}

// "Прибываний: N · ⏱ Xч Yм" — вместо блока показаний для зон
// accountingMode="stays" (docs/spec/04-game-room.md, "Деньги и сдача
// итогов": "Telegram/email-уведомлений по каждому отдельному пуску нет —
// только агрегат в сводке сдачи итогов").
//
// Именно "Прибываний", не "Пусков" (обратная связь пользователя 2026-08-04):
// раньше здесь стоял тот же ключ, что и у режима Пусков, и сводка называла
// режим чужим словом — при том, что в настройках зоны, в спеке и в CLAUDE.md
// он везде "Прибывания".
// Записан ли способ оплаты у КАЖДОЙ операции зоны. У Прибываний/Пусков он
// лежит в самом пуске (Launch.paymentMethod), у Билетов — в заказе. У
// "Счётчиков"/"Только касса" такого нет: выручка берётся с показаний счётчика
// за день, а нал/безнал сотрудник объявляет общими суммами при сдаче итогов.
function hasPerOperationPaymentMethod(data: ZoneSummaryData): boolean {
  return data.isGameRoom || data.accountingMode === "launches" || data.accountingMode === "tickets";
}

function formatGameRoomLine(data: ZoneSummaryData, st: SummaryText): string {
  const count = data.gameRoomLaunchCount ?? 0;
  const minutes = data.gameRoomTotalMinutes ?? 0;
  // Часы значком вместо слова "время" (обратная связь пользователя
  // 2026-08-04) — в сводке и так тесно, а часы читаются мгновенно и на любом
  // языке. Ключ launchesTimeLabel остаётся: его использует email-сводка, где
  // строки идут таблицей "подпись — значение" и значок вместо подписи
  // выглядел бы дырой в колонке.
  return `🎮 ${st.staysCountLabel}: <b>${count}</b> · ⏱ <b>${formatDuration(minutes, true)}</b>`;
}

// "Пусков: N · время: Xч Yм" — та же формула, что formatGameRoomLine выше
// (запрос пользователя 2026-07-28: "Пуски" теперь тоже могут быть
// таймерными, время сессии стало осмысленным — раньше здесь намеренно не
// было времени, "тапы мгновенные"). Для плоских мгновенных тарифов
// (startedAt===endedAt) вклад в totalMinutes просто 0 — отдельной ветки не
// требуется.
function formatLaunchesTallyLine(data: ZoneSummaryData, st: SummaryText): string {
  const count = data.gameRoomLaunchCount ?? 0;
  const minutes = data.gameRoomTotalMinutes ?? 0;
  // Часы значком вместо слова "время" (обратная связь пользователя
  // 2026-08-04) — в сводке и так тесно, а часы читаются мгновенно и на любом
  // языке. Ключ launchesTimeLabel остаётся: его использует email-сводка, где
  // строки идут таблицей "подпись — значение" и значок вместо подписи
  // выглядел бы дырой в колонке.
  return `🎮 ${st.launchesCountLabel}: <b>${count}</b> · ⏱ <b>${formatDuration(minutes, true)}</b>`;
}

// "Заказов: N · Билетов: M" — Билеты (docs/spec/10-tickets.md) не имеют ни
// показаний (readings), ни разреза по активу в духе perAsset (заказ может
// содержать разные активы одновременно) — единственная содержательная
// строка сводки для этого режима — счётчики заказов/билетов.
function formatTicketsLine(data: ZoneSummaryData, st: SummaryText): string {
  const orders = data.ticketsOrdersCount ?? 0;
  const tickets = data.ticketsCount ?? 0;
  return `🎫 ${st.ticketsOrdersCountLabel}: <b>${orders}</b> · ${st.ticketsSoldCountLabel}: <b>${tickets}</b>`;
}

// Разбивка по активу для "Прибываний"/"Пусков" — той же формы, что уже есть
// у "Счётчиков" (запрос пользователя 2026-07-19: "в них нет Активов как мы
// делали в режиме Счётчики"), но count+amount вместо "было→стало" — у пусков
// нет непрерывного счётчика, только дискретные события.
// fullNames — только у Прибываний (см. formatCompactGrid). Имя передаётся
// СЫРЫМ: обрезать его здесь заранее нельзя, иначе сетка получит уже
// укороченную строку и растягивать будет нечего.
function formatPerAssetTallyCompact(perAsset: ZoneSummaryData["perAsset"], fullNames = false): string {
  const grid = formatCompactGrid(
    perAsset.map((a) => ({ label: a.assetName, value: String(a.count) })),
    fullNames
  );
  return `<blockquote><code>${grid}</code></blockquote>`;
}

function formatPerAssetTallyFull(perAsset: ZoneSummaryData["perAsset"], locale: Locale): string {
  const labelWidth = Math.max(...perAsset.map((a) => `${a.assetName}:`.length));
  const rows = perAsset.map((a) => {
    const label = `${a.assetName}:`.padEnd(labelWidth + 1);
    // escapeTelegramHtml — после padEnd, см. комментарий в formatCompactGrid.
    return escapeTelegramHtml(`${label}${String(a.count).padStart(3)}  (${formatMoney(a.amount, locale)})`);
  });
  return `<blockquote><code>${rows.join("\n")}</code></blockquote>`;
}

export function formatZoneSummaryTelegram(
  data: ZoneSummaryData,
  settings: ZoneSummarySettingsData,
  locale: Locale,
  timezone: string,
  st: SummaryText
): string {
  if (settings.compact) {
    const parts: string[] = [zoneHeader(data, settings.showOperator, timezone)];

    if (data.accountingMode === "cash_only") {
      parts.push(`💵 ${st.cashOnly}: <b>${formatMoney(data.cashAmount, locale)}</b>`);
      // Справочно (аудит 2026-07-25) — cash_only тоже поддерживает оплату
      // балансом, но раньше эта ветка её нигде не показывала, в отличие от
      // веб-кабинета ("Итоги дня"), где строка "Баланс" была всегда.
      if (data.abonementAmount > 0) {
        parts.push(`🎫 ${st.abonementCompact}: <b>${formatMoney(data.abonementAmount, locale)}</b>`);
      }
    } else {
      if (data.isGameRoom) {
        if (settings.showReadings) {
          parts.push(formatGameRoomLine(data, st));
          // Прибывания — имена активов целиком (см. formatCompactGrid).
          if (data.perAsset.length > 0) parts.push(formatPerAssetTallyCompact(data.perAsset, true));
        }
      } else if (data.accountingMode === "launches") {
        if (settings.showReadings) {
          parts.push(formatLaunchesTallyLine(data, st));
          if (data.perAsset.length > 0) parts.push(formatPerAssetTallyCompact(data.perAsset));
        }
      } else if (data.accountingMode === "tickets") {
        if (settings.showReadings) parts.push(formatTicketsLine(data, st));
      } else if (settings.showReadings && data.readings.length > 0) {
        const grid = formatCompactGrid(
          data.readings.map((r, i) => ({ label: compactAssetLabel(data.readings, i), value: String(r.reading) }))
        );
        parts.push(`<blockquote><code>${grid}</code></blockquote>`);
      }

      if (settings.showCash || settings.showCalc) {
        // Нал.+Безнал вместе, не один cashAmount — иначе строка не сходится
        // с Разн. (та считается от суммы обоих, как и на сервере, см.
        // submit-results/route.ts: actualCash = cashAmount + mobileAmount).
        // Фидбек пользователя 2026-07-12: "Касса 1345, а по счётчикам 1715 —
        // разница должна быть -370", но показанная compact-строка сравнивала
        // только cashAmount, без mobileAmount — расхождение было в отображении,
        // не в расчёте разницы (та всегда считалась правильно).
        // Каждый способ оплаты — своей строкой, ниже их сумма "Оплачено"
        // рядом со счётом (решение пользователя 2026-08-04 из трёх показанных
        // раскладок). Раньше нал и безнал были слиты в одну "Кассу", а баланс
        // висел отдельной строкой ниже — и сравнить с "Счёт." глазами было
        // нечего: 184 против 326 не сходились, потому что 142 стояли не там.
        //
        // Слово "Касса" тут больше не используется СОЗНАТЕЛЬНО: оно означает
        // физические деньги в ящике, а сумма, равная счёту, включает баланс
        // абонемента — деньги, полученные раньше, при пополнении. Назвать её
        // "Кассой" значило бы сломать сверку наличных.
        const paidTotal = data.cashAmount + data.mobileAmount + data.abonementAmount;
        // HTML-сущности, не голые "<"/">" (реальный сбой отправки, найден
        // 2026-07-18 по продовым логам: "Bad Request: can't parse entities" —
        // Telegram с parse_mode="HTML" воспринимает голый "<" как начало
        // тега и роняет отправку целиком, зона не приходит вообще).
        // Знак берётся из УЖЕ ПОСЧИТАННОЙ разницы, а не из сравнения двух
        // чисел этой строки (обратная связь пользователя 2026-08-04, скриншот
        // Халабуды: "Касса: 184 < Счёт.: 326" при "Разн.: 0" — карточка
        // противоречила сама себе). 142 из этих 326 клиенты заплатили
        // балансом абонемента, недостачи не было; difference это знает, а
        // сравнение cashAmount+mobileAmount с calculatedRevenue — нет.
        //
        // Третий заход на одни и те же грабли в этой строке: сперва тут
        // забыли mobileAmount (2026-07-12), потом ту же слепоту к абонементу
        // чинили в самом расчёте разницы (2026-07-18) — и знак остался
        // последним местом, куда фикс не дошёл. Привязка к difference
        // закрывает класс целиком: что бы ни появилось новым способом оплаты
        // дальше, знак и строка "Разн." физически не смогут разойтись.
        const cmp = data.difference < 0 ? "&lt;" : data.difference > 0 ? "&gt;" : "=";
        // Разбивка по способам оплаты — только там, где способ известен ПО
        // КАЖДОЙ операции: у Прибываний/Пусков он записан в самом пуске
        // (Launch.paymentMethod), у Билетов — в заказе. В "Счётчиках" его
        // нет: выручка считается по показаниям счётчика за день, а нал и
        // безнал сотрудник объявляет общими суммами в конце смены —
        // раскладывать их построчно значило бы выдавать объявленный итог за
        // точную разбивку платежей (уточнение пользователя 2026-08-04: "в
        // Счётчиках мы не знаем какой метод оплаты"). Баланс там при этом
        // возможен (оплату балансом распространили на Счётчики 2026-07-20) и
        // показывается своей строкой ниже, как и раньше.
        const perMethodKnown = hasPerOperationPaymentMethod(data);

        // Разбивку показываем, только когда способов оплаты БОЛЬШЕ ОДНОГО:
        // при единственном способе его строка дословно повторяла бы
        // "Оплачено" ниже тем же числом (обратная связь пользователя
        // 2026-08-04). Только ненулевые — "Безнал: 0" в зоне, где безналом
        // не платили, ничего не сообщает (тот же принцип, что у строки
        // "Баланс" с 2026-07-17).
        const usedMethods = [data.cashAmount, data.mobileAmount, data.abonementAmount].filter((a) => a > 0).length;

        if (settings.showCash && perMethodKnown && usedMethods > 1) {
          if (data.cashAmount > 0) parts.push(`💵 ${st.cashCompact}: <b>${formatMoney(data.cashAmount, locale)}</b>`);
          if (data.mobileAmount > 0) parts.push(`💳 ${st.mobile}: <b>${formatMoney(data.mobileAmount, locale)}</b>`);
          if (data.abonementAmount > 0) {
            parts.push(`🎫 ${st.abonementCompact}: <b>${formatMoney(data.abonementAmount, locale)}</b>`);
          }
        }

        const bits: string[] = [];
        if (settings.showCash) {
          // "Оплачено" (нал+безнал+баланс) — только у режимов с известным
          // способом оплаты; в остальных остаётся прежняя "Касса" (нал+безнал),
          // потому что баланс туда сознательно не входит: эти деньги касса
          // получила раньше, при пополнении абонемента.
          bits.push(
            perMethodKnown
              ? `💰 ${st.paidCompact}: <b>${formatMoney(paidTotal, locale)}</b>`
              : `💵 ${st.cashOnly}: <b>${formatMoney(data.cashAmount + data.mobileAmount, locale)}</b>`
          );
        }
        if (settings.showCash && settings.showCalc) bits.push(cmp);
        if (settings.showCalc) bits.push(`🔢 ${st.calculatedCompact}: <b>${formatMoney(data.calculatedRevenue, locale)}</b>`);
        parts.push(bits.join("  "));
      }
      // Баланс отдельной строкой у режимов БЕЗ пооперационного способа оплаты
      // (у остальных он уже показан выше, среди способов) — справочно, не в
      // "Кассу": она получила эти деньги раньше, при пополнении абонемента
      // (запрос пользователя 2026-07-17).
      if (settings.showCash && !hasPerOperationPaymentMethod(data) && data.abonementAmount > 0) {
        parts.push(`🎫 ${st.abonementCompact}: <b>${formatMoney(data.abonementAmount, locale)}</b>`);
      }
      // Возвраты — понятие только "Счётчиков" (docs/spec/10-tickets.md: у
      // Билетов/Прибываний/Пусков returnsCount на сервере всегда 0, строка
      // ничего не сообщала бы, см. тот же комментарий ниже в full-режиме).
      const showReturnsHere = settings.showReturns && data.accountingMode === "counters";
      if (settings.showDiff || showReturnsHere) {
        const bits: string[] = [];
        if (settings.showDiff) {
          const sign = data.difference > 0 ? "+" : "";
          bits.push(`${diffEmoji(data.difference)} ${st.differenceCompact}: <b>${sign}${formatMoney(data.difference, locale)}</b>`);
        }
        if (settings.showDiff && showReturnsHere) bits.push("·");
        if (showReturnsHere) bits.push(`🔄 ${st.returnsCompact}: <b>${data.returnsCount}</b>`);
        parts.push(bits.join("  "));
      }
    }

    return parts.join("\n");
  }

  const lines: string[] = [zoneHeader(data, settings.showOperator, timezone)];

  if (data.accountingMode === "cash_only") {
    lines.push("", `💵 ${st.cashOnly}: <b>${formatMoney(data.cashAmount, locale)}</b>`);
    if (data.abonementAmount > 0) {
      lines.push(`🎫 ${st.abonement}: <b>${formatMoney(data.abonementAmount, locale)}</b>`);
    }
  } else {
    if (data.isGameRoom) {
      if (settings.showReadings) {
        lines.push("", formatGameRoomLine(data, st));
        if (data.perAsset.length > 0) lines.push("", formatPerAssetTallyFull(data.perAsset, locale));
      }
    } else if (data.accountingMode === "launches") {
      if (settings.showReadings) {
        lines.push("", formatLaunchesTallyLine(data, st));
        if (data.perAsset.length > 0) lines.push("", formatPerAssetTallyFull(data.perAsset, locale));
      }
    } else if (data.accountingMode === "tickets") {
      if (settings.showReadings) lines.push("", formatTicketsLine(data, st));
    } else if (settings.showReadings || settings.showDelta) {
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
        // escapeTelegramHtml — после padEnd, см. комментарий в formatCompactGrid.
        return escapeTelegramHtml(row);
      });
      // Цитата + code (фидбек пользователя 2026-07-09) — Telegram Bot API
      // поддерживает <blockquote> с вложенным <code>, многострочно через \n.
      lines.push("", `<blockquote><code>${readingRows.join("\n")}</code></blockquote>`);
    }

    // Возвраты — понятие только "Счётчиков" (docs/spec/10-tickets.md: "Шаг
    // возвратов/тестовых не показывается [у Билетов] — его роль у
    // аннулирования", тот же принцип у Прибываний/Пусков): для остальных
    // режимов returnsCount на сервере всегда 0 (submit-results/route.ts),
    // строка ничего не сообщала бы.
    const showReturnsFull = settings.showReturns && data.accountingMode === "counters";
    if (settings.showCash || settings.showCalc || settings.showDiff || showReturnsFull) {
      lines.push("");
      if (settings.showCash) {
        // Наличные и Безнал раздельными строками, не через " · " (запрос
        // пользователя 2026-07-27, тот же принцип, что уже применён в Кассе
        // за день) — строк не жалко.
        lines.push(`💵 ${st.cash}: <b>${formatMoney(data.cashAmount, locale)}</b>`);
        lines.push(`💳 ${st.mobile}: <b>${formatMoney(data.mobileAmount, locale)}</b>`);
        // Справочно, отдельной строкой, НЕ в кассе выше — уже получена
        // раньше, при пополнении абонемента (запрос пользователя 2026-07-17).
        if (data.abonementAmount > 0) {
          lines.push(`🎫 ${st.abonement}: <b>${formatMoney(data.abonementAmount, locale)}</b>`);
        }
      }
      if (settings.showCalc) lines.push(`🔢 ${st.calculated}: <b>${formatMoney(data.calculatedRevenue, locale)}</b>`);
      if (settings.showDiff) {
        const sign = data.difference > 0 ? "+" : "";
        lines.push(`${diffEmoji(data.difference)} ${st.difference}: <b>${sign}${formatMoney(data.difference, locale)}</b>`);
      }
      if (showReturnsFull) lines.push(`↩️ ${st.returns}: <b>${data.returnsCount}</b>`);
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
function formatZoneBreakdownRows(zoneBreakdown: DailyCashSummaryData["zoneBreakdown"], locale: Locale): string {
  const labelWidth = Math.max(...zoneBreakdown.map((z) => `${z.zoneName}:`.length));
  // "(+X)" абонементом убран (запрос пользователя 2026-07-25) — дублировал
  // отдельную строку "Баланс" ниже и визуально намекал, что баланс
  // складывается с кассой зоны, хотя это не так (весь вечерний разбор про
  // то, что баланс у Счётчиков — отдельная, не смешивается с кассой).
  // escapeTelegramHtml — после padEnd, см. комментарий в formatCompactGrid.
  return zoneBreakdown
    .map((z) => escapeTelegramHtml(`${z.zoneName}:`.padEnd(labelWidth + 1) + formatMoney(z.revenue, locale)))
    .join("\n");
}

export function formatDailyCashSummaryTelegram(
  data: DailyCashSummaryData,
  settings: DailyCashSummarySettingsData,
  locale: Locale,
  timezone: string,
  st: SummaryText
): string {
  const total = data.cashAmount + data.mobileAmount - data.expenses;
  // Одна и та же строка в обоих видах сводки: она и так короткая, укорачивать
  // её отдельно для компактного вида нечем.
  const note = pendingNote(data.pending, st, locale);

  if (settings.compact) {
    const parts: string[] = dailyCashHeaderLines(data, timezone, st);

    if (note) parts.push(`⚠️ ${note}`);

    // Разбивка по зонам — сразу под заголовком "КАССА" (запрос пользователя
    // 2026-07-16: "подними выше эти данные"), а не в самом низу под итогом —
    // это детализация того, из чего сложилась касса, логичнее видеть её
    // раньше сводных сумм, а не после них.
    if (settings.showZoneBreakdown && data.zoneBreakdown.length > 0) {
      parts.push(`<blockquote><code>${formatZoneBreakdownRows(data.zoneBreakdown, locale)}</code></blockquote>`);
    }

    if (settings.showCash) {
      // Наличные и Безнал раздельными строками (запрос пользователя
      // 2026-07-27: "и в компактной сводке тоже" — та же правка, что уже
      // сделали в full-режиме, объединённая строка через " · " переносилась
      // посередине суммы на длинных значениях, читалось коряво).
      parts.push(`💵 ${st.cashCompact}: <b>${formatMoney(data.cashAmount, locale)}</b>`);
      parts.push(`💳 ${st.mobile}: <b>${formatMoney(data.mobileAmount, locale)}</b>`);
      if (data.abonementAmount > 0) {
        parts.push(`🎫 ${st.abonementCompact}: <b>${formatMoney(data.abonementAmount, locale)}</b>`);
      }
      // Продажа абонементов — реальные деньги, отдельно от абонемента-как-
      // способа-оплаты выше (запрос пользователя 2026-07-18: тот же разрыв,
      // что уже закрыт в Итогах дня/Отчётах/Остатках).
      if (data.abonementSold.cash + data.abonementSold.mobile > 0) {
        parts.push(
          `🎫 ${st.abonementSoldCompact}: <b>${formatMoney(data.abonementSold.cash + data.abonementSold.mobile, locale)}</b>`
        );
      }
    }
    if (settings.showExpenses) {
      // Расходы и Аванс+Прем — раньше одной строкой через " · " (запрос
      // пользователя 2026-07-19), теперь разнесены на отдельные строки
      // (запрос пользователя 2026-07-20) — тот же тумблер, обе строки об
      // одном: деньги, ушедшие из кассы за день, но не Расход бизнеса в
      // бухгалтерском смысле.
      parts.push(`🛒 ${st.expenses}: ${formatMoney(data.expenses, locale)}`);
      parts.push(`💵 ${st.bonusesAndAdvancesCompact}: ${formatMoney(data.bonusesAndAdvances, locale)}`);
    }

    // Остаток на точке — рядом с Итогом, тем же разделителем " · ", что и
    // везде в compact-режиме (запрос пользователя 2026-07-14: раньше был
    // отдельной строкой в самом низу).
    const totalBits = [`🗓️ ${st.totalCompact}: <b>${formatMoney(total, locale)}</b>`];
    if (settings.showCashOnHand) totalBits.push(`🛃 ${st.cashOnHandCompact}: ${formatMoney(data.cashOnHand, locale)}`);
    parts.push(totalBits.join(" · "));

    return parts.join("\n");
  }

  const lines: string[] = dailyCashHeaderLines(data, timezone, st);

  if (note) {
    lines.push("", `⚠️ ${note}`);
  }

  if (settings.showZoneBreakdown && data.zoneBreakdown.length > 0) {
    lines.push("", `<blockquote><code>${formatZoneBreakdownRows(data.zoneBreakdown, locale)}</code></blockquote>`);
  }

  lines.push("");
  if (settings.showCash) {
    // Наличные и Безнал раздельными строками, не через " · " (запрос
    // пользователя 2026-07-27) — в отличие от compact-режима, где место в
    // дефиците и разделитель оправдан, здесь строк не жалко.
    lines.push(`💵 ${st.cash}: <b>${formatMoney(data.cashAmount, locale)}</b>`);
    lines.push(`💳 ${st.mobile}: <b>${formatMoney(data.mobileAmount, locale)}</b>`);
    if (data.abonementAmount > 0) {
      lines.push(`🎫 ${st.abonement}: <b>${formatMoney(data.abonementAmount, locale)}</b>`);
    }
    if (data.abonementSold.cash + data.abonementSold.mobile > 0) {
      lines.push(
        `🎫 ${st.abonementSold}: <b>${formatMoney(data.abonementSold.cash + data.abonementSold.mobile, locale)}</b>`
      );
    }
  }
  if (settings.showExpenses) {
    lines.push(`🛒 ${st.expenses}: ${formatMoney(data.expenses, locale)}`);
    // Сразу после Расходов (запрос пользователя 2026-07-17), тот же
    // тумблер — обе строки об одном: деньги, ушедшие из кассы за день, но
    // не Расход бизнеса в бухгалтерском смысле.
    lines.push(`💵 ${st.bonusesAndAdvances}: ${formatMoney(data.bonusesAndAdvances, locale)}`);
  }
  lines.push(`🗓️ ${st.totalFull}: <b>${formatMoney(total, locale)}</b>`);

  if (settings.showCashOnHand) {
    lines.push("", `🛃 ${st.cashOnHand}: ${formatMoney(data.cashOnHand, locale)}`);
  }

  return lines.join("\n");
}

export function formatShiftCloseSummaryTelegram(
  data: ShiftCloseSummaryData,
  settings: ShiftCloseSummarySettingsData,
  locale: Locale,
  timezone: string,
  st: SummaryText
): string {
  // Цветовой квадрат перед именем оператора (фидбек пользователя 2026-07-12) —
  // и в компактном, и в обычном виде; null (метка не задана) — без эмодзи.
  const colorPrefix = colorTagToEmoji(data.operatorColorTag);
  // 👑 после имени — смену или её аванс/премию правил Владелец (см. zoneHeader).
  const safeOperatorName = `${escapeTelegramHtml(data.operatorName)}${data.editedByOwner ? " 👑" : ""}`;
  const operatorLabel = colorPrefix ? `${colorPrefix} ${safeOperatorName}` : safeOperatorName;

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
    if (settings.showPeriod) parts.push(`🕐 ${formatLocalTime(data.startAt, timezone)}–${formatLocalTime(data.endAt, timezone)}`);
    if (settings.showHours) parts.push(`▶️ ${formatDuration(data.minutes, true)}`);
    // Аванс: 0 показывается всегда при включённом тумблере (запрос
    // пользователя 2026-07-18: "если сотрудник не брал Аванс, то надо
    // выводить Аванс: 0") — в отличие от Премии ниже, которая по-прежнему
    // скрывается при 0 (не просили менять).
    if (settings.showAdvance) parts.push(`💵 ${st.advance}: ${formatMoney(data.advanceAmount, locale)}`);
    if (settings.showBonus && data.bonusAmount > 0)
      parts.push(
        `🏆 ${data.bonusIsAccrual ? st.bonusAccruedCompact : st.bonusCompact}: ${formatMoney(data.bonusAmount, locale)}`
      );
    if (settings.showTotal) parts.push(`💰 ${st.toPayOutCompact}: <b>${formatMoney(data.toPayOut, locale)}</b>`);

    // Не жирным (запрос пользователя 2026-07-17/18: "во всех сводках с
    // итогами... не надо имя Сотрудника и дату делать жирным") — тот же
    // принцип, что уже применён в zoneHeader выше, тут был пропущен.
    const header = `${operatorLabel} · ${formatDate(data.startAt, timezone)}`;
    const rows: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      rows.push(parts.slice(i, i + 2).join(" · "));
    }
    return [header, ...rows].join("\n");
  }

  const lines: string[] = [`${operatorLabel} · ${st.shiftWord} ${formatDate(data.startAt, timezone)}`, ""];

  if (settings.showPeriod) lines.push(`🕐 ${st.period}: ${formatLocalTime(data.startAt, timezone)} – ${formatLocalTime(data.endAt, timezone)}`);
  if (settings.showHours) lines.push(`▶️ ${st.hoursWorked}: ${formatDuration(data.minutes)}`);
  if (settings.showAdvance) lines.push(`💵 ${st.advance}: ${formatMoney(data.advanceAmount, locale)}`);
  if (settings.showBonus && data.bonusAmount > 0)
    lines.push(`🏆 ${data.bonusIsAccrual ? st.bonusAccrued : st.bonus}: ${formatMoney(data.bonusAmount, locale)}`);
  if (settings.showTotal) lines.push(`💰 ${st.toPayOutFull}: <b>${formatMoney(data.toPayOut, locale)}</b>`);

  return lines.join("\n");
}

export function formatInstructionAckTelegram(data: InstructionAckData, st: SummaryText, minutesShort: string): string {
  const name = escapeTelegramHtml(data.fullName);
  const title = escapeTelegramHtml(data.instructionTitle);
  // Без спрягаемого глагола ("ознакомился"/"ознакомилась") — пол сотрудника
  // приложение не хранит, а безличная формулировка "инструктаж пройден"
  // (SummaryText.instructionPassed) не требует согласования ни в одном языке.
  return `✅ <b>${name}</b> · «${title}» · ${data.readingMinutes} ${minutesShort} · ${st.instructionPassed}`;
}

/**
 * Новый расход — формат задан владельцем 2026-08-15, ровно три строки:
 *   🛒 РАСХОД — 15/08, 22:46
 *   🟩 Женя: 350 ₽
 *   Выплата стажёру · Машинки
 * Дата без дня недели (в отличие от сводок): уведомление приходит в момент
 * события, "какой сегодня день" владельцу и так известно, а короткая шапка
 * целиком помещается в заголовок Push-уведомления (dispatch.ts шлёт первую
 * строку как title, остальные две — как body).
 *
 * Сумма — со знаком валюты тенанта, если он выбран (formatMoneyWithCurrency,
 * тот же вывод, что у <Money> в кабинете): в сводках знак опускается, там
 * валюта ясна из контекста таблицы, а здесь это одинокая цифра в шторке
 * уведомлений телефона.
 */
export function formatExpenseAlertHeader(data: ExpenseAlertData, st: SummaryText, timezone: string): string {
  const date = formatSummaryDate(data.occurredAt, "/", timezone, false);
  return `🛒 ${st.expenseAlertTitle} — ${date}, ${formatLocalTime(data.occurredAt, timezone)}`;
}

// Третья строка: "Категория {эмодзи зоны} Зона", без категории — эмодзи и
// зона. Названия пользовательские, поэтому каждое подрезается: в
// Push-уведомлении на строку приходится примерно столько символов, дальше
// система обрежет сама — и обрежет ЗОНУ целиком, если категорию не
// ограничить. Комментарий сотрудника подрезается щедрее: это единственное
// место, где он вообще виден владельцу без захода в кабинет.
const ALERT_NAME_LIMIT = 28;
const ALERT_COMMENT_LIMIT = 80;
// 🏁 — тот же запасной эмодзи, что у заголовка сводки по зоне, если владелец
// не выбрал зоне свой (Zone.telegramEmoji).
const DEFAULT_ZONE_EMOJI = "🏁";

function clamp(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

function expenseContext(data: ExpenseAlertData, limit = ALERT_NAME_LIMIT): string {
  const emoji = data.zoneEmoji || DEFAULT_ZONE_EMOJI;
  const zone = `${emoji} ${clamp(data.zoneName, limit)}`;
  return data.categoryName ? `${clamp(data.categoryName, limit)} ${zone}` : zone;
}

export function formatExpenseAlertLines(
  data: ExpenseAlertData,
  locale: Locale,
  currency: string | null | undefined
): string[] {
  // Цветовая метка сотрудника остаётся на месте, 👑 добавляется ПОСЛЕ имени
  // (уточнение владельца 2026-08-16): корона говорит "запись правил
  // Владелец", а не "это его запись" — кто потратил деньги, видно по-прежнему.
  const mark = colorTagToEmoji(data.operatorColorTag);
  const crown = data.editedByOwner ? " 👑" : "";
  const lines = [`${mark ? `${mark} ` : ""}${data.operatorName}${crown}: ${formatMoneyWithCurrency(data.amount, locale, currency as CurrencyCode | null)}`];
  lines.push(expenseContext(data));
  // В Push цитаты и курсива нет — комментарий идёт обычной строкой, кавычки
  // отделяют его от названий выше.
  if (data.comment) lines.push(`«${clamp(data.comment, ALERT_COMMENT_LIMIT)}»`);
  return lines;
}

/**
 * Инкассация — формат владельца 2026-08-16, три строки:
 *   🏦 ИНКАССАЦИЯ (Аванс) — 16/08, 00:30
 *   🟩 Женя 👑: 1 500 ₽
 *   🎠 Машинки 700 ₽ · 🛍 Товары 200 ₽
 * Третья строка — из каких касс собраны деньги: зоны своими эмодзи (те же,
 * что в сводке по зоне), пулы товаров и абонементов — фиксированными.
 * Владелец сам провёл инкассацию — вместо имени 👑 (имени у него нет, в
 * отличие от правки чужой записи, где имя остаётся).
 */
const GOODS_EMOJI = "🛍";
const ABONEMENT_EMOJI = "🎟";

function collectionParts(data: CollectionAlertData, st: SummaryText, locale: Locale, currency: string | null | undefined): string[] {
  const money = (v: number) => formatMoneyWithCurrency(v, locale, currency as CurrencyCode | null);
  const parts = data.zones
    .filter((z) => z.amount > 0)
    .map((z) => `${z.emoji || DEFAULT_ZONE_EMOJI} ${z.name} ${money(z.amount)}`);
  if (data.goodsAmount > 0) parts.push(`${GOODS_EMOJI} ${st.goodsLabel} ${money(data.goodsAmount)}`);
  if (data.abonementAmount > 0) parts.push(`${ABONEMENT_EMOJI} ${st.abonementSold} ${money(data.abonementAmount)}`);
  return parts;
}

function collectionWho(data: CollectionAlertData): string {
  if (!data.operatorName) return "👑";
  const mark = colorTagToEmoji(data.operatorColorTag);
  return `${mark ? `${mark} ` : ""}${data.operatorName}${data.editedByOwner ? " 👑" : ""}`;
}

export function formatCollectionAlertTelegram(
  data: CollectionAlertData,
  st: SummaryText,
  locale: Locale,
  timezone: string,
  currency: string | null | undefined
): string {
  const title = data.isAdvance ? `${st.collectionAlertTitle} (${st.advance})` : st.collectionAlertTitle;
  const when = `${formatSummaryDate(data.occurredAt, "/", timezone, false)}, ${formatLocalTime(data.occurredAt, timezone)}`;
  const lines = [
    `🏦 <b>${escapeTelegramHtml(title)}</b> — ${when}`,
    `${escapeTelegramHtml(collectionWho(data))}: <b>${formatMoneyWithCurrency(data.amount, locale, currency as CurrencyCode | null)}</b>`,
  ];
  const parts = collectionParts(data, st, locale, currency);
  if (parts.length > 0) lines.push(escapeTelegramHtml(parts.join(" · ")));
  return lines.join("\n");
}

/** Те же строки для Push — без HTML, шапка отдельно от тела. */
export function formatCollectionAlertPush(
  data: CollectionAlertData,
  st: SummaryText,
  locale: Locale,
  timezone: string,
  currency: string | null | undefined
): { title: string; body: string } {
  const title = data.isAdvance ? `${st.collectionAlertTitle} (${st.advance})` : st.collectionAlertTitle;
  const when = `${formatSummaryDate(data.occurredAt, "/", timezone, false)}, ${formatLocalTime(data.occurredAt, timezone)}`;
  const bodyLines = [
    `${collectionWho(data)}: ${formatMoneyWithCurrency(data.amount, locale, currency as CurrencyCode | null)}`,
  ];
  const parts = collectionParts(data, st, locale, currency);
  if (parts.length > 0) bodyLines.push(parts.join(" · "));
  return { title: `🏦 ${title} — ${when}`, body: bodyLines.join("\n") };
}

export function formatExpenseAlertTelegram(
  data: ExpenseAlertData,
  st: SummaryText,
  locale: Locale,
  timezone: string,
  currency: string | null | undefined
): string {
  const mark = colorTagToEmoji(data.operatorColorTag);
  const name = `${escapeTelegramHtml(data.operatorName)}${data.editedByOwner ? " 👑" : ""}`;
  const lines = [
    `🛒 <b>${st.expenseAlertTitle}</b> — ${formatSummaryDate(data.occurredAt, "/", timezone, false)}, ${formatLocalTime(data.occurredAt, timezone)}`,
    `${mark ? `${mark} ` : ""}${name}: <b>${formatMoneyWithCurrency(data.amount, locale, currency as CurrencyCode | null)}</b>`,
    // Названия в Telegram не подрезаем — ширина сообщения там не ограничена,
    // усечение нужно только шторке уведомлений телефона (Number.MAX_SAFE_INTEGER
    // как "без предела" вместо второй копии сборки строки).
    escapeTelegramHtml(expenseContext(data, Number.MAX_SAFE_INTEGER)),
  ];
  // Комментарий сотрудника — цитатой курсивом (формат владельца 2026-08-15):
  // это его собственные слова, а не поле карточки, и визуально они не должны
  // мешаться с названиями выше. <blockquote> Telegram поддерживает в HTML.
  if (data.comment) lines.push(`<blockquote><i>${escapeTelegramHtml(data.comment)}</i></blockquote>`);
  return lines.join("\n");
}
