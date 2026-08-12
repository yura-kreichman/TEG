import { isRichContentEmpty, type PMNode } from "@/lib/rich-text";

// Общая инфраструктура печати (запрос пользователя 2026-07-20) — чистый
// браузер, без доп. софта. Самодостаточная разметка/CSS (без Tailwind/
// CSS-переменных приложения) переиспользуется в двух РАЗНЫХ местах со своей
// изоляцией у каждого:
// - живое превью в Настройках → Система — полноценный изолированный HTML-
//   документ (buildReceiptHtml, через <iframe srcDoc>), гарантированно
//   показывает именно то, что реально напечатается;
// - реальная печать (openPrintDocument) — НЕ отдельный документ (после двух
//   неудачных попыток на Android, см. комментарий у openPrintDocument ниже),
//   а сама текущая страница приложения с временно подменённым видимым
//   содержимым через @media print. Именно поэтому весь CSS написан с
//   единой точкой сброса .receipt-doc, а не голыми html/body — второй сценарий
//   вставляет этот же CSS ПРЯМО в текущую страницу, где html/body принадлежат
//   приложению, а не изолированному документу.
//
// Годится и на 58/80мм термопринтер через @page, и на обычный A4/Letter —
// принтер настраивается на уровне ОС устройства, приложение о типе
// подключения ничего не знает и не хранит (docs/design обсуждение
// 2026-07-20).


export interface PrintLine {
  label: string;
  value: string;
  bold?: boolean;
  /** Крупнее обычной строки — для названия тарифа/товара, "что купили"
   * (запрос пользователя 2026-07-20): у режимов с ровно одной позицией за
   * документ (Пуски, Товары) название — главное, что нужно разглядеть. */
  large?: boolean;
  /** Мельче обычной строки — для длинных однотипных перечислений, где важна
   * длина бумаги, а не читаемость каждой строки с расстояния (запрос
   * пользователя 2026-08-12: список смен в Выписке по расчётам, до 31 строки
   * за месяц — обычным кеглем это лишние 3 см рулона на ровном месте). */
  small?: boolean;
}

export interface PrintSection {
  title?: string;
  lines: PrintLine[];
  /** Линия отреза (ножницы + пунктир) сразу после этой секции — не обычный
   * лёгкий разделитель между секциями, а явное "здесь можно оторвать".
   * Билеты (docs/spec/10-tickets.md, запрос пользователя 2026-07-21:
   * "распечатывать одним документом, много диалоговых окон — неправильно") —
   * несколько билетов заказа печатаются ОДНИМ вызовом печати (не N отдельных,
   * как раньше), каждый билет — своя секция с этим флагом, чтобы физически
   * разрезать рулон на отдельные билеты после печати. */
  cutLineAfter?: boolean;
}

export interface PrintDocumentData {
  /** Заголовок документа — "Чек", "Z-отчёт сдачи итогов", "Выписка баланса" и т.п. */
  title: string;
  /** Обычно — название зоны/точки + дата-время. Объектная форма — для
   * документов, где под заголовком нужна "личность" (например, клиент в
   * выписке баланса): primary крупнее (имя), secondary — как обычный
   * subtitle под ним (например, телефон), запрос пользователя 2026-07-20. */
  subtitle?: string | { primary: string; secondary?: string };
  sections: PrintSection[];
  /** Итоговая строка — крупнее и жирным, отдельно от секций. Поставь
   * `stacked: true`, если подпись длинная: тогда она встанет отдельной
   * строкой, а сумма — под ней крупно, вместо того чтобы делить одну строку
   * и ломаться на узком рулоне. */
  totalLine?: PrintLine & { stacked?: boolean };
}

export interface ReceiptBranding {
  tenantName: string;
  logoUrl: string | null;
  /** Настройки → Система, блок "Квитанция" — что показывать в шапке (запрос пользователя 2026-07-20). */
  showLogo: boolean;
  showTenantName: boolean;
  /** Компактная шапка — лого слева, название тенанта + заголовок документа
   * справа от него, вместо раскладки в столбик (запрос пользователя
   * 2026-07-20: экономит высоту рулона термопринтера). */
  compactHeader: boolean;
  /** Ширина рулона/тип принтера — "58"/"80" (мм) или "a4" — обычный
   * лазерный/струйный принтер (запрос пользователя 2026-07-26, откат
   * тенантского Int-поля: настройка теперь per-устройство у Оператора,
   * per-браузер у Владельца — см. use-print.ts). "a4" НЕ форсирует @page
   * size — см. комментарий у receiptCss ниже. */
  paperWidth: ReceiptPaperWidth;
  /** Подвал квитанции (Настройки → Система) — ProseMirror JSON, произвольный
   * текст Владельца внизу каждого документа. Возвращён 2026-08-12 после
   * удаления 2026-07-21 — историю и условия отката см. у поля
   * Tenant.receiptFooterContent в prisma/schema.prisma. */
  footerContent?: PMNode | null;
}

export type ReceiptPaperWidth = "58" | "80" | "a4";

// Размер бумаги ЯВНО форсируется для "58"/"80" (запрос пользователя
// 2026-07-26 — ОТКАТ решения "не форсируем" от 2026-07-20, см. ниже).
// Реальный баг, найден на живой печати у Керен Центра, 80мм принтер,
// --kiosk-printing: "size: auto" — это, по документации Chromium, "дефолт
// БРАУЗЕРА, настраиваемый в диалоге печати", а НЕ реальная ширина рулона
// драйвера/ОС (подтверждено внешним источником при расследовании — auto НЕ
// читает системный дефолт принтера, это давний, отдельный баг Chromium). В
// --kiosk-printing диалога нет вообще, поэтому Chrome тихо подставляет свой
// внутренний дефолт (обычно A4/Letter) — а термопринтер печатает это 1:1,
// без масштабирования, и просто обрезает всё, что не влезло в физический
// рулон по бокам. Прежнее решение "не форсируем, пусть auto подстроится под
// любой рулон" никогда не работало для kiosk-printing — сама механика auto
// не про это. Ширина — явная настройка на уровне устройства (Оператор) или
// браузера (Владелец, обсуждение 2026-07-26: "мне не нравится... на разных
// привязанных устройствах тоже может быть разная ширина бумаги"),
// ".receipt { width: 100% }" ниже гарантирует, что контент заполняет ровно
// эту заданную ширину.
//
// "a4" — обычный лазерный/струйный принтер (тот же запрос: "может кто-то
// просто на принтере а4 печатает") — единственный вариант, где size ОСТАЁТСЯ
// auto: сам найденный баг специфичен для термопринтера в связке с
// --kiosk-printing (у него нет своего разумного дефолта паперсайза, drivers
// такого типа обычно и не сообщают его толком), а не для kiosk-printing как
// таковой — обычный принтер настроен на A4 уже в самой ОС/драйвере и auto
// для него исторически работал нормально. .receipt всё равно остаётся узкой
// колонкой (80mm) на середине/левом крае листа A4, а не растягивается на
// весь лист — вид "чек, распечатанный на A4", как у большинства POS-веб-
// приложений с этим же fallback-сценарием.
//
// Шрифты/межстрочные отступы — после двух раундов правки по живым
// распечаткам с реального термопринтера (запрос пользователя 2026-07-20).
// Первый раунд ("шрифты мелкие") их укрупнил, второй — "слишком крупные
// шрифты истории операций... квитанции должны быть компактнее" — вернул
// обратно вниз и одновременно заметно сжал line-height/отступы между
// строками; текущие значения — итог обеих правок, не промежуточное
// состояние.
// .receipt-doc — единая точка входа для сброса (было html,body раньше) —
// нужна, чтобы этот же CSS можно было безопасно вставить ПРЯМО в текущую
// страницу приложения (не только в изолированный iframe/document), не
// затрагивая html/body самого приложения (реальный риск — найден при
// переходе на "печать текущей страницы" 2026-07-20: голый селектор html,body
// сломал бы фон/шрифт всего приложения в момент печати). .receipt-doc
// ставится и на <body> изолированного документа (buildReceiptHtml, превью
// в Настройках → Система), и на обёртку внутри печатного корня
// (openPrintDocument) — один и тот же CSS работает в обоих местах.
function receiptCss(paperWidth: ReceiptPaperWidth): string {
  // Узкая колонка — фиксированная физическая ширина документа, независимо от
  // размера бумаги: 58/80 повторяют выбор Владельца/Оператора, "a4" всегда
  // 80mm (см. комментарий выше — просто самый частый термо-рулон, тут это
  // уже не про реальный принтер, а про то, насколько широкой рисовать саму
  // квитанцию на большом листе).
  const columnWidthMm = paperWidth === "a4" ? 80 : Number(paperWidth);
  const pageSize = paperWidth === "a4" ? "auto" : `${paperWidth}mm auto`;
  return `
  @page { size: ${pageSize}; margin: 3mm; }
  * { box-sizing: border-box; }
  .receipt-doc {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    /* Строго #000, не #111/#444/т.п. "приглушённый" серый (запрос
       пользователя 2026-07-26, живой скриншот) — термопринтер не умеет
       печатать настоящий серый, только дизерит его в разреженные точки,
       отсюда и блёклость/полосатость на "приглушённых" элементах (телефон,
       заголовки разделов). У обычного экрана/PDF разница между #000 и #111
       незаметна, так что для превью это тоже безопасно. */
    color: #000;
    background: #fff;
  }
  /* Канва + рваный край бумаги — ТОЛЬКО на экране (превью в Настройках →
     Система, запрос пользователя 2026-07-20: "чтобы было понятно, что это
     квитанция"). На печати (@media print ниже) полностью убрано — реальный
     термо-рулон уже физически имеет такой край, рисовать его чернилами на
     самой квитанции незачем и просто тратит расходники. */
  @media screen {
    .receipt-doc { background: #e7e9ec; }
    /* Ширина — та же физическая columnWidthMm, что у .receipt ниже (запрос
       пользователя 2026-07-20: превью должно выглядеть как настоящая
       бумага рулона) — без этого рваный край растягивался на всю
       ширину canvas превью, шире самой квитанции, и не совпадал с её краями. */
    .receipt-paper { position: relative; max-width: ${columnWidthMm}mm; margin: 0 auto; padding: 14px 0; }
    .receipt-paper::before,
    .receipt-paper::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      height: 11px;
      background-image:
        linear-gradient(135deg, #e7e9ec 50%, transparent 50%),
        linear-gradient(-135deg, #e7e9ec 50%, transparent 50%);
      background-size: 16px 16px;
      background-repeat: repeat-x;
    }
    .receipt-paper::before { top: 0; background-position: top; }
    .receipt-paper::after { bottom: 0; background-position: bottom; }
  }
  /* max-width — физическая единица (mm), не произвольные px (запрос
     пользователя 2026-07-20: "предпросмотр должен отображать, как он реально
     выглядит" — mm браузер трактует одинаково что на экране, что при
     печати, поэтому Xmm здесь = настоящие X мм и на мониторе, и на бумаге).
     На печати для "58"/"80" эта же ширина действует и в @page выше (запрос
     пользователя 2026-07-26, откат прежнего "max-width: none на печати" —
     см. комментарий у @page) — Xmm тут ДОЛЖНО совпадать с шириной ветки
     @page, иначе контент и физическая страница снова разъедутся. Для "a4"
     страница шире колонки НАРОЧНО (см. columnWidthMm выше) — тут разъезд
     ожидаем и правилен: узкий чек посреди/сбоку большого листа. */
  .receipt {
    width: 100%;
    max-width: ${columnWidthMm}mm;
    margin: 0 auto;
    padding: 10px 6px;
    font-size: 14px;
    line-height: 1.25;
    /* Базовая жирность 600, не 400 (запрос пользователя 2026-07-26, живой
       скриншот) — на термопринтере нет полутонов, только чёрная точка или её
       отсутствие; обычное/тонкое начертание даёт браузеру больше сглаженных
       серых пикселей по краям букв ОТНОСИТЕЛЬНО площади самой буквы, драйвер
       вынужден их дизерить — отсюда полосатость на тонком тексте (телефон,
       даты) при чистой печати жирного (название компании, суммы). Наследуется
       всеми дочерними элементами, кроме тех, где уже стоит свой явный
       font-weight (.receipt-total/.receipt-tenant/.receipt-title и т.п. —
       они и так были жирнее и печатались чисто, тут ничего не меняется). */
    font-weight: 600;
  }
  /* break-inside: avoid на МЕЛКИХ неделимых кусках — защитная мера из
     расследования реального бага 2026-07-21..22 (искажённая печать на
     Bluetooth ESC/POS-мосту), который в итоге оказался на 100% привязан к
     самому наличию футера в документе (см. историю у
     Tenant.receiptFooterContent, поле удалено). Футер убран совсем, правило
     само по себе безвредно и разумно оставить как общую защиту от разрыва
     блока между "страницами" — НО НЕ на .receipt-paper целиком: реальный
     баг, найден пользователем 2026-07-24 на длинной Выписке баланса
     (владелец, A4/PDF, много строк истории) — "avoid" на ВСЁМ документе
     заставлял браузер при нехватке места на первой странице переносить
     ВЕСЬ блок (шапку и список целиком) на вторую, а не только не разрывать
     список ПОСЕРЕДИНЕ строки — отсюда пустая первая страница и список,
     начинающийся сразу со второй, а не сразу после шапки. Для короткого
     чека (Пуски/Товары — вся суть break-inside и задумывалась под них) это
     не меняет ничего, там документ и так помещается на одну страницу
     целиком независимо от этого правила. */
  .receipt-header,
  .receipt-section,
  .receipt-line,
  .receipt-total,
  .receipt-cut-line,
  .receipt-footer {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  @media screen {
    .receipt {
      background: #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,.12);
    }
  }
  .receipt-header { text-align: center; margin-bottom: 6px; }
  /* filter убран ОКОНЧАТЕЛЬНО (2026-07-28, диагностика MHT-P5801) — живой
     тест на реальном устройстве подтвердил причину зависания на шапке: не
     сама картинка (файл маленький, 640×221px/16KB), а именно CSS-фильтрация
     (grayscale+contrast+brightness — честный per-pixel проход по каждому
     пикселю растра при печати через Chrome → Print Service → Bluetooth-мост)
     — без фильтра тот же логотип печатается чисто и без зависаний. Прежний
     смысл фильтра (см. историю git) был косметическим — убрать цвет и
     поднять контраст ДО дизеринга драйвером принтера, а не полагаться на
     дизеринг сырого цвета — не стоит компромисса "чек не печатается вовсе".
     Заодно снимает и другой побочный эффект: полноцветные лазерные/струйные
     принтеры (paperWidth "a4") печатали логотип принудительно
     чёрно-белым, хотя реальному цветному принтеру это не нужно. */
  .receipt-logo {
    max-width: 180px;
    max-height: 90px;
    margin: 0 auto 5px;
    display: block;
  }
  .receipt-tenant { font-size: 17px; font-weight: 800; }
  .receipt-title { font-size: 14px; font-weight: 700; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
  .receipt-subtitle { font-size: 12.65px; color: #000; margin-top: 2px; }
  /* Имя клиента в выписке баланса — крупнее обычного subtitle, телефон под
     ним обычным subtitle-стилем (запрос пользователя 2026-07-20). */
  .receipt-subtitle-name { font-size: 15px; font-weight: 700; color: #000; margin-top: 2px; }
  /* Компактная шапка (запрос пользователя 2026-07-20) — в основе перестановка:
     лого слева, название тенанта + заголовок документа справа от него, а не
     раскладка сверху вниз по центру — короче по высоте, заметно на
     термопринтере. Текст остаётся того же размера, что в обычной шапке
     (первый запрос: "не уменьшай размер логотипа и текстов, просто
     перенеси") — единственное сознательное исключение из этого правила,
     добавленное позже отдельными запросами: лого именно в компактном режиме
     сначала −10%, затем ещё −15% от результата (180x90 → 162x81 → 137.7x68.85),
     текст без изменений. */
  .receipt-header-compact { text-align: left; }
  .receipt-header-compact .receipt-header-row { display: flex; align-items: center; gap: 10px; }
  .receipt-header-compact .receipt-logo { max-width: 137.7px; max-height: 68.85px; margin: 0; flex-shrink: 0; }
  /* flex: 1 — колонка тянется на всю оставшуюся ширину строки (не сжимается
     по контенту), иначе разделительная линия на .receipt-title ниже
     заканчивалась бы на ширине самого текста, а не доходила до правого края
     квитанции (запрос пользователя 2026-07-20: "линия должна идти до конца
     правой стороны"). */
  .receipt-header-compact .receipt-header-text { display: flex; flex: 1; flex-direction: column; justify-content: center; min-width: 0; }
  /* Разделительная линия между названием компании и заголовком квитанции
     (запрос пользователя 2026-07-20) — только в компактной шапке, где они
     стоят друг под другом в одном узком блоке рядом с лого. */
  .receipt-header-compact .receipt-title {
    margin-top: 3px;
    padding-top: 3px;
    border-top: 4px solid #ccc;
  }
  .receipt-header-compact .receipt-subtitle,
  .receipt-header-compact .receipt-subtitle-name { margin-top: 3px; }
  .receipt-section { margin-top: 5px; padding-top: 5px; border-top: 1px dashed #999; }
  .receipt-section:first-of-type { border-top: none; }
  .receipt-section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #000;
    margin-bottom: 2px;
  }
  .receipt-line { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 13.685px; }
  .receipt-line .label { color: #000; }
  .receipt-line .value { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .receipt-line.bold { font-weight: 700; }
  .receipt-line.large { font-size: 17px; font-weight: 700; }
  .receipt-line.small { font-size: 11.5px; padding: 0; }
  .receipt-total {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid #111;
    font-size: 18px;
    font-weight: 800;
  }
  /* Итог в две строки: подпись сверху обычным кеглем, сумма под ней крупно
     (запрос пользователя 2026-08-12, реальная распечатка — "К выдаче за всё
     время" и "2 319,93 ₽" в одной flex-строке на 58мм не помещались, знак
     валюты уезжал на следующую строку и сумма ломалась пополам). Отдельный
     модификатор, а не правка .receipt-total: у коротких документов (чек,
     слип инкассации) однострочный итог читается лучше и ломать его незачем. */
  .receipt-total.stacked {
    display: block;
    text-align: center;
  }
  .receipt-total.stacked .label {
    display: block;
    font-size: 13px;
    font-weight: 600;
  }
  .receipt-total.stacked .value {
    display: block;
    margin-top: 2px;
    font-size: 26px;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  /* Подвал квитанции. Кегль совпадает с .receipt-subtitle (строка даты) —
     это тоже служебная приписка, а не содержание документа.
     overflow-wrap: break-word обязателен — длинное «слово» без пробелов
     (ссылка, номер) иначе вылезает за 58мм вместо переноса: обычный перенос
     рвёт строку только по пробелам. */
  .receipt-footer {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px dashed #999;
    font-size: 12.65px;
    line-height: 1.35;
  }
  .receipt-footer p { margin: 0 0 3px; overflow-wrap: break-word; }
  .receipt-footer p:last-child { margin-bottom: 0; }
  .receipt-footer ul, .receipt-footer ol { margin: 0 0 3px; padding-left: 16px; }
  .receipt-footer .rt-h1 { font-size: 15px; font-weight: 700; margin: 0 0 3px; }
  .receipt-footer .rt-h2 { font-size: 13.5px; font-weight: 700; margin: 0 0 3px; }
  /* Линия отреза (запрос пользователя 2026-07-20) — в конце каждой
     квитанции: иконка ножниц + чёрная пунктирная линия. Изначальные 2мм
     смотрелись слишком жирно (фидбек того же дня) — уменьшено до 0.5мм. */
  .receipt-cut-line { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .receipt-cut-icon { flex-shrink: 0; font-size: 16px; line-height: 1; color: #000; }
  .receipt-cut-dash { flex: 1; border-top: 0.5mm dashed #000; }
`;
}

// Экранирует и кавычки — используется не только в текстовых узлах, но и
// внутри HTML-атрибута (src="..." у лого ниже); без экранирования кавычек
// значение, содержащее ", могло бы вырваться из атрибута (найдено при
// самопроверке 2026-07-20).
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Линия отреза (запрос пользователя 2026-07-20) — ножницы + чёрная
// пунктирная линия; вынесена в отдельную функцию (запрос пользователя
// 2026-07-21) — теперь нужна не только один раз в конце документа, но и
// между билетами внутри одного многобилетного документа (см. PrintSection.cutLineAfter).
function renderCutLineHtml(): string {
  return `
    <div class="receipt-cut-line">
      <span class="receipt-cut-icon">✂</span>
      <span class="receipt-cut-dash"></span>
    </div>
  `;
}

/**
 * PMNode → строка HTML для подвала квитанции. Отдельно от
 * components/landing/rich-text.tsx (тот отдаёт JSX для React-страницы) —
 * здесь документ собирается как строка и React в этом пути нет вовсе.
 *
 * Набор узлов и марок — тот же белый список, что валидирует сервер
 * (ALLOWED_CHILD_NODE_TYPES/ALLOWED_MARK_TYPES в lib/rich-text.ts). Всё
 * незнакомое рендерится своим содержимым без обёртки: подвал должен
 * деградировать в текст, а не исчезать, если редактор однажды научится
 * новому узлу раньше этого файла.
 */
function renderFooterNode(node: PMNode): string {
  const children = (node.content ?? []).map(renderFooterNode).join("");
  switch (node.type) {
    case "text": {
      let html = escapeHtml(node.text ?? "");
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") html = `<strong>${html}</strong>`;
        else if (mark.type === "italic") html = `<em>${html}</em>`;
        else if (mark.type === "underline") html = `<u>${html}</u>`;
      }
      return html;
    }
    case "hardBreak":
      return "<br>";
    case "horizontalRule":
      return "<hr>";
    case "paragraph":
      return `<p>${children}</p>`;
    case "heading":
      // Классы, а не настоящие h1/h2 — как на лендинге: в квитанции никакой
      // семантики заголовков нет, нужен только размер.
      return `<div class="${node.attrs?.level === 2 ? "rt-h2" : "rt-h1"}">${children}</div>`;
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol>${children}</ol>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    default:
      return children;
  }
}

function renderFooterHtml(content: PMNode | null | undefined): string {
  // isRichContentEmpty, а не проверка строки на пустоту: очищенное состояние
  // ProseMirror — это `<p></p>`, непустая строка (реальный баг прошлой версии
  // подвала, 2026-07-20: пустой подвал рисовал видимую рамку с отбивкой).
  if (!content || isRichContentEmpty(content)) return "";
  return `<div class="receipt-footer">${renderFooterNode(content)}</div>`;
}

function renderSection(section: PrintSection): string {
  const title = section.title ? `<div class="receipt-section-title">${escapeHtml(section.title)}</div>` : "";
  const lines = section.lines
    .map((l) => {
      const cls = [l.bold && "bold", l.large && "large", l.small && "small"].filter(Boolean).join(" ");
      return `<div class="receipt-line${cls ? ` ${cls}` : ""}"><span class="label">${escapeHtml(l.label)}</span><span class="value">${escapeHtml(l.value)}</span></div>`;
    })
    .join("");
  const cutLine = section.cutLineAfter ? renderCutLineHtml() : "";
  return `<div class="receipt-section">${title}${lines}</div>${cutLine}`;
}

function renderSubtitle(subtitle: PrintDocumentData["subtitle"]): string {
  if (!subtitle) return "";
  if (typeof subtitle === "string") {
    return `<div class="receipt-subtitle">${escapeHtml(subtitle)}</div>`;
  }
  const primary = `<div class="receipt-subtitle-name">${escapeHtml(subtitle.primary)}</div>`;
  const secondary = subtitle.secondary ? `<div class="receipt-subtitle">${escapeHtml(subtitle.secondary)}</div>` : "";
  return primary + secondary;
}

/** Тело документа (без <html>/<head>) — переиспользуется и в реальной печати (openPrintDocument), и в превью через iframe srcDoc. */
export function buildReceiptBodyHtml(data: PrintDocumentData, branding: ReceiptBranding): string {
  const logo = branding.showLogo && branding.logoUrl ? `<img class="receipt-logo" src="${escapeHtml(branding.logoUrl)}" alt="" />` : "";
  const tenantName = branding.showTenantName ? `<div class="receipt-tenant">${escapeHtml(branding.tenantName)}</div>` : "";
  const title = `<div class="receipt-title">${escapeHtml(data.title)}</div>`;
  const subtitle = renderSubtitle(data.subtitle);
  const sections = data.sections.map(renderSection).join("");
  const total = data.totalLine
    ? `<div class="receipt-total${data.totalLine.stacked ? " stacked" : ""}"><span class="label">${escapeHtml(data.totalLine.label)}</span><span class="value">${escapeHtml(data.totalLine.value)}</span></div>`
    : "";
  const header = branding.compactHeader
    ? `
      <div class="receipt-header receipt-header-compact">
        <div class="receipt-header-row">
          ${logo}
          <div class="receipt-header-text">
            ${tenantName}
            ${title}
          </div>
        </div>
        ${subtitle}
      </div>
    `
    : `
      <div class="receipt-header">
        ${logo}
        ${tenantName}
        ${title}
        ${subtitle}
      </div>
    `;

  // Линия отреза (запрос пользователя 2026-07-20) — в конце КАЖДОГО
  // документа, после всего остального содержимого, не отдельным условием —
  // принтеру всё равно нечего печатать дальше, это финальный элемент.
  const cutLine = renderCutLineHtml();
  // Подвал — между итогом и линией отреза: это приписка ко всему документу,
  // а отрез по-прежнему остаётся последним, ниже него печатать нечего.
  const footer = renderFooterHtml(branding.footerContent);

  return `
    <div class="receipt-paper">
      <div class="receipt">
        ${header}
        ${sections}
        ${total}
        ${footer}
        ${cutLine}
      </div>
    </div>
  `;
}

export function buildReceiptHtml(data: PrintDocumentData, branding: ReceiptBranding): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.title)}</title>
<style>${receiptCss(branding.paperWidth)}</style>
</head>
<body class="receipt-doc">${buildReceiptBodyHtml(data, branding)}</body>
</html>`;
}

// Печатаем ТЕКУЩУЮ страницу целиком, БЕЗ отдельного документа вообще — ни
// window.open() (реальный баг, найден пользователем 2026-07-20: SecurityError
// "Blocked a frame ... from accessing a cross-origin frame" на win.print() —
// в PWA Оператора на части Android-браузеров window.open() открывает окно в
// изолированном браузинг-контексте с opaque origin), ни iframe.print()
// (следующая попытка — реальный вывод, найден пользователем 2026-07-20:
// даже с реальным размером и без visibility:hidden часть Android-браузеров и
// сторонние принт-сервисы вроде "ESCPOS Bluetooth Print Service" всё равно
// печатали ВСЮ страницу приложения вместо содержимого iframe — давний,
// по сей день открытый баг Chromium именно с печатью ВЛОЖЕННОГО документа на
// Android/мобильных print-пайплайнах, issues.chromium.org/issues/40896385,
// не имеющий полностью надёжного фикса средствами кода). Вместо печати
// вложенного документа — печатаем сам document/window (window.print() без
// аргументов, самый базовый и повсеместно поддерживаемый путь, никаких
// вложенных браузинг-контекстов вообще), временно подменяя ВИДИМОЕ содержимое
// страницы квитанцией через CSS @media print (классическая техника "print
// only this element" — body > *:not(#печатный-корень) прячется, печатный
// корень показывается) — у этого пути просто нет кросс-frame границы, на
// которой ломается вся предыдущая цепочка попыток.
const PRINT_ROOT_ID = "rentos-print-root";

function ensurePrintRoot(): HTMLElement {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = PRINT_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

export function openPrintDocument(data: PrintDocumentData, branding: ReceiptBranding): void {
  const root = ensurePrintRoot();
  // ОТКАТ (2026-07-25): пробовали вынести этот <style> в globals.css
  // (гипотеза — печатный конвейер Android Chrome не успевает учесть стили,
  // вставленные в DOM непосредственно перед window.print()), проверено на
  // реальном устройстве — стало ХУЖЕ: печать вообще перестала что-либо
  // выводить (раньше печаталась вся страница, что тоже плохо, но хоть
  // что-то). Гипотеза не подтвердилась и полностью откачена (включая
  // добавление в globals.css) — возвращено рабочее, пусть не идеальное
  // состояние: печать всей страницы вместо только квитанции остаётся
  // открытой, непонятой проблемой на Android, см. историю у openPrintDocument
  // выше про уже отвергнутые гипотезы (iframe, window.open).
  root.innerHTML = `
    <style>
      #${PRINT_ROOT_ID} { display: none; }
      @media print {
        body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
        #${PRINT_ROOT_ID} { display: block !important; }
      }
      ${receiptCss(branding.paperWidth)}
    </style>
    <div class="receipt-doc">${buildReceiptBodyHtml(data, branding)}</div>
  `;

  // Заголовок документа — предлагаемое имя файла у "Сохранить в PDF" (та же
  // мелочь, что раньше давал отдельный <title> изолированного документа) —
  // временно подменяется на заголовок квитанции, восстанавливается после.
  const previousTitle = document.title;
  let restored = false;
  function cleanup() {
    if (restored) return;
    restored = true;
    document.title = previousTitle;
    // Очищаем печатный корень (аудит 2026-07-25, финальный проход) — иначе
    // его @media print CSS ("body>*:not(#корень) скрыт") остаётся глобально
    // действующим ПОСЛЕ печати, на весь остаток вкладки: любой СЛЕДУЮЩИЙ
    // window.print() (случайный Ctrl+P, стороннее расширение) молча
    // перепечатывал бы ЭТУ ЖЕ, уже устаревшую квитанцию вместо реальной
    // страницы — root это obычный DOM-узел вне React-дерева, "Сменить
    // сотрудника" (client-side навигация, без полной перезагрузки) его не
    // трогает. На тихом киоске (--kiosk-printing, без диалога подтверждения)
    // это реально означает случайную повторную печать чека ПРЕДЫДУЩЕГО
    // клиента другому сотруднику/клиенту незаметно для персонала.
    root.innerHTML = "";
  }

  let printed = false;
  function triggerPrint() {
    if (printed) return;
    printed = true;
    document.title = data.title;
    // РЕАЛЬНАЯ причина обоих багов печати на Android (2026-07-25, найдено
    // через внешний источник — issue react-to-print #526 на GitHub, тот же
    // класс проблемы): "afterprint" на Android Chrome документированно
    // стреляет СРАЗУ после window.print(), НЕ дожидаясь, пока реальный
    // печатный конвейер (особенно сторонний Print Service для Bluetooth
    // ESC/POS-принтера — Android отдаёт ему PDF асинхронно, тот сам его ещё
    // конвертирует и стримит по Bluetooth) успеет забрать содержимое
    // страницы. Раньше здесь был слушатель afterprint → cleanup(), который
    // стирал печатный корень (root.innerHTML = "") ПРЕЖДЕ, чем Android
    // реально успевал его отрендерить:
    //   - с инлайн-<style> внутри root (текущая версия) — стирались И CSS
    //     правила видимости, И контент → печаталась вся страница целиком
    //     (первый найденный баг);
    //   - когда CSS временно жил в globals.css (эксперимент, откачен) —
    //     правила видимости уцелевали (не в root), а контент всё равно
    //     стирался → печатный корень оставался пустым, видимым, но БЕЗ
    //     содержимого → пустой PDF (второй найденный баг, стало хуже).
    // Оба бага — одна и та же гонка, просто с разным итогом. Фикс: НЕ
    // полагаемся на afterprint вообще (на Android ему верить нельзя),
    // только фиксированная задержка, с запасом на асинхронный сторонний
    // Print Service, а не только на нативный "Сохранить в PDF".
    setTimeout(cleanup, 10000);
    window.print();
  }

  // Та же гонка, что уже чинили для лого (2026-07-20), но для ТЕКСТА, не
  // картинки — реальный баг с искажённой печатью при непустом футере
  // (2026-07-21..22), подтверждён пользователем: воспроизводится даже на
  // КОРОТКОЙ квитанции и даже на обычном тексте, без richtext — значит дело
  // не в высоте документа и не в форматировании (обе версии уже проверены и
  // отклонены), а в том, что футер обычно — САМЫЙ первый текст в этом
  // конкретном документе, для которого браузеру ещё не приходилось
  // растеризовать эти конкретные кириллические глифы: document.fonts.ready
  // может быть не готов (шрифт/начертание догружается или ещё не
  // прошейпился), а window.print() ниже раньше не ждал НИЧЕГО, кроме лого —
  // print мог захватить кадр с ещё не отрисованным (или отрисованным
  // временным fallback-шрифтом другой ширины) футером, что на растровом
  // ESC/POS-мосту читается как испорченный хвост документа. Двойной rAF —
  // стандартный приём "дождаться реального paint", не только запланированного.
  function waitForRenderThenPrint() {
    let proceeded = false;
    function proceed() {
      if (proceeded) return;
      proceeded = true;
      requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
    }
    if (typeof document.fonts !== "undefined" && document.fonts.status !== "loaded") {
      document.fonts.ready.then(proceed).catch(proceed);
      // Фолбэк — не блокировать печать вечно, если fonts.ready почему-то не
      // резолвится (редкие браузерные баги).
      setTimeout(proceed, 1000);
    } else {
      proceed();
    }
  }

  // Реальный баг, найден пользователем 2026-07-20: "иногда при первой
  // генерации квитанции логотип не отображается, при повторной уже
  // появляется" — window.print() вызывался сразу после вставки innerHTML, не
  // дожидаясь, пока браузер реально ЗАГРУЗИТ <img> (сетевой запрос,
  // асинхронный) — печать могла захватить кадр раньше, чем лого успевало
  // отрисоваться. На повторной попытке лого уже в HTTP-кэше браузера,
  // грузится мгновенно, гонки не видно. Явно ждём загрузки лого (если оно
  // вообще есть в этом документе) перед печатью — img.complete уже true,
  // если картинка закэширована (частый случай), тогда ждать не нужно вообще.
  // Дальше — waitForRenderThenPrint выше, тот же принцип, но для текста.
  const logo = root.querySelector<HTMLImageElement>(".receipt-logo");
  if (logo && !logo.complete) {
    logo.addEventListener("load", waitForRenderThenPrint, { once: true });
    logo.addEventListener("error", waitForRenderThenPrint, { once: true });
    // Фолбэк — не блокировать печать вечно, если лого вообще не загрузится
    // (плохая сеть, битая ссылка).
    setTimeout(waitForRenderThenPrint, 1500);
  } else {
    waitForRenderThenPrint();
  }
}
