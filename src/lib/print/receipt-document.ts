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
  /** Итоговая строка — крупнее и жирным, отдельно от секций. */
  totalLine?: PrintLine;
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
}

// Размер бумаги НЕ форсируем ("size: 80mm auto" раньше) — реальная ширина
// рулона (58/80мм) уже задана на уровне драйвера/ОС того устройства, где
// физически стоит принтер (запрос пользователя 2026-07-20: "квитанции сами
// масштабируются под размеры бумаги") — если жёстко просить 80мм у
// 58-миллиметрового рулона, драйвер либо обрежет, либо сам пересожмёт
// страницу. "size: auto" отдаёт ширину странице целиком на откуп
// драйверу/ОС, а ".receipt { width: 100% }" ниже гарантирует, что контент
// всегда заполняет ровно ту ширину, что реально пришла — без разъезда
// в обе стороны, независимо от рулона.
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
const RECEIPT_CSS = `
  @page { size: auto; margin: 3mm; }
  * { box-sizing: border-box; }
  .receipt-doc {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #111;
    background: #fff;
  }
  /* Канва + рваный край бумаги — ТОЛЬКО на экране (превью в Настройках →
     Система, запрос пользователя 2026-07-20: "чтобы было понятно, что это
     квитанция"). На печати (@media print ниже) полностью убрано — реальный
     термо-рулон уже физически имеет такой край, рисовать его чернилами на
     самой квитанции незачем и просто тратит расходники. */
  @media screen {
    .receipt-doc { background: #e7e9ec; }
    /* Ширина — та же физическая 58mm, что у .receipt ниже (запрос
       пользователя 2026-07-20: превью должно выглядеть как настоящая
       58-миллиметровая бумага) — без этого рваный край растягивался на всю
       ширину canvas превью, шире самой квитанции, и не совпадал с её краями. */
    .receipt-paper { position: relative; max-width: 58mm; margin: 0 auto; padding: 14px 0; }
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
     выглядит на 58 мм" — mm браузер трактует одинаково что на экране, что
     при печати, поэтому 58mm здесь = настоящие 58мм на мониторе, не
     приблизительная имитация). На реальную печать это не влияет вообще — на
     @media print ниже max-width сбрасывается в none, страница уже физически
     той ширины, что выбрана в драйвере/ОС; 58mm — только для превью в
     Настройках → Система, самый частый размер термо-рулона. */
  .receipt {
    width: 100%;
    max-width: 58mm;
    margin: 0 auto;
    padding: 10px 6px;
    font-size: 14px;
    line-height: 1.25;
  }
  /* break-inside: avoid везде — защитная мера из расследования реального
     бага 2026-07-21..22 (искажённая печать на Bluetooth ESC/POS-мосту),
     который в итоге оказался на 100% привязан к самому наличию футера в
     документе (richtext/обычный текст, короткий/длинный чек — не влияло,
     см. историю у Tenant.receiptFooterContent, поле удалено). Футер убран
     совсем, но правило само по себе безвредно и разумно оставить как общую
     защиту от разрыва блока между "страницами". */
  .receipt-paper,
  .receipt-header,
  .receipt-section,
  .receipt-line,
  .receipt-total,
  .receipt-cut-line {
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
  /* filter — подготовка лого перед печатью на термопринтере (запрос
     пользователя 2026-07-20, уточнено после проверки 2026-07-20: "уверен,
     что термопринтер передаст оттенки серого?" — нет, не уверен, и это не
     то, что этот фильтр обещает). У большинства чековых термопринтеров нет
     настоящих оттенков серого на уровне печатающей головки — "серый" на
     бумаге всегда иллюзия дизеринга/halftone, который применяет ДРАЙВЕР
     принтера при печати растра, а не эта страница. grayscale+contrast здесь
     только убирают цвет и поднимают контраст ДО того, как драйвер сам
     продизерит картинку в чёрно-белую точечную сетку — так дизеринг получает
     более чистый источник (меньше гадать по цветовым каналам), чем при
     дизеринге сырого цветного лого напрямую. Настоящий канвас-дизеринг
     (Floyd-Steinberg и т.п.) дал бы более предсказуемый результат, но
     требует обработки пикселей через canvas, не CSS-фильтра — здесь предел
     того, что достижимо без неё. */
  .receipt-logo {
    max-width: 180px;
    max-height: 90px;
    margin: 0 auto 5px;
    display: block;
    filter: grayscale(1) contrast(1.35) brightness(1.05);
  }
  .receipt-tenant { font-size: 17px; font-weight: 800; }
  .receipt-title { font-size: 14px; font-weight: 700; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
  .receipt-subtitle { font-size: 12.65px; color: #444; margin-top: 2px; }
  /* Имя клиента в выписке баланса — крупнее обычного subtitle, телефон под
     ним обычным subtitle-стилем (запрос пользователя 2026-07-20). */
  .receipt-subtitle-name { font-size: 15px; font-weight: 700; color: #222; margin-top: 2px; }
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
    color: #444;
    margin-bottom: 2px;
  }
  .receipt-line { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 13.685px; }
  .receipt-line .label { color: #222; }
  .receipt-line .value { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .receipt-line.bold { font-weight: 700; }
  .receipt-line.large { font-size: 17px; font-weight: 700; }
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
  /* Линия отреза (запрос пользователя 2026-07-20) — в конце каждой
     квитанции: иконка ножниц + чёрная пунктирная линия. Изначальные 2мм
     смотрелись слишком жирно (фидбек того же дня) — уменьшено до 0.5мм. */
  .receipt-cut-line { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .receipt-cut-icon { flex-shrink: 0; font-size: 16px; line-height: 1; color: #000; }
  .receipt-cut-dash { flex: 1; border-top: 0.5mm dashed #000; }
  @media print {
    .receipt { max-width: none; }
  }
`;

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

function renderSection(section: PrintSection): string {
  const title = section.title ? `<div class="receipt-section-title">${escapeHtml(section.title)}</div>` : "";
  const lines = section.lines
    .map((l) => {
      const cls = [l.bold && "bold", l.large && "large"].filter(Boolean).join(" ");
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
    ? `<div class="receipt-total"><span>${escapeHtml(data.totalLine.label)}</span><span>${escapeHtml(data.totalLine.value)}</span></div>`
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

  return `
    <div class="receipt-paper">
      <div class="receipt">
        ${header}
        ${sections}
        ${total}
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
<style>${RECEIPT_CSS}</style>
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
  root.innerHTML = `
    <style>
      #${PRINT_ROOT_ID} { display: none; }
      @media print {
        body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
        #${PRINT_ROOT_ID} { display: block !important; }
      }
      ${RECEIPT_CSS}
    </style>
    <div class="receipt-doc">${buildReceiptBodyHtml(data, branding)}</div>
  `;

  // Заголовок документа — предлагаемое имя файла у "Сохранить в PDF" (та же
  // мелочь, что раньше давал отдельный <title> изолированного документа) —
  // временно подменяется на заголовок квитанции, восстанавливается после.
  const previousTitle = document.title;
  let restored = false;
  function restoreTitle() {
    if (restored) return;
    restored = true;
    document.title = previousTitle;
  }

  let printed = false;
  function triggerPrint() {
    if (printed) return;
    printed = true;
    document.title = data.title;
    window.addEventListener("afterprint", restoreTitle, { once: true });
    setTimeout(restoreTitle, 5000);
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
