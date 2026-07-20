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

import { isRichContentEmpty, type PMNode } from "@/lib/rich-text";

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
  /** Rich text (ProseMirror JSON, src/lib/rich-text.ts) — тот же формат, что у Лендинга/Инструктажей. */
  footerContent: PMNode | null;
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
// Шрифты укрупнены (запрос пользователя 2026-07-20: "на мой взгляд шрифты
// мелкие и не ориентированы на размеры бумаги 58/80 мм") — на 58мм рулоне
// (~32 моноширинных символа в строке при обычном ESC/POS-шрифте) прежние
// 11-13px читались бы как убористая мелкая печать, крупнее — ближе к
// реальным чекам из магазинов.
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
    .receipt-paper { position: relative; padding: 14px 0; }
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
  .receipt {
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    padding: 10px 6px;
    font-size: 19px;
    line-height: 1.5;
  }
  @media screen {
    .receipt {
      background: #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,.12);
    }
  }
  .receipt-header { text-align: center; margin-bottom: 12px; }
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
    margin: 0 auto 8px;
    display: block;
    filter: grayscale(1) contrast(1.35) brightness(1.05);
  }
  .receipt-tenant { font-size: 23px; font-weight: 800; }
  .receipt-title { font-size: 20px; font-weight: 700; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.06em; }
  .receipt-subtitle { font-size: 16px; color: #444; margin-top: 3px; }
  /* Имя клиента в выписке баланса — крупнее обычного subtitle, телефон под
     ним обычным subtitle-стилем (запрос пользователя 2026-07-20). */
  .receipt-subtitle-name { font-size: 19px; font-weight: 700; color: #222; margin-top: 4px; }
  /* Компактная шапка (запрос пользователя 2026-07-20) — только перестановка:
     лого слева, название тенанта + заголовок документа справа от него, а не
     раскладка сверху вниз по центру — короче по высоте, заметно на
     термопринтере. Размеры лого и текстов НЕ меняются (запрос пользователя
     2026-07-20: "не уменьшай размер логотипа и текстов, просто перенеси") —
     только layout/отступы, шрифты/max-width/max-height те же, что в обычной
     шапке. */
  .receipt-header-compact { text-align: left; }
  .receipt-header-compact .receipt-header-row { display: flex; align-items: center; gap: 10px; }
  .receipt-header-compact .receipt-logo { margin: 0; flex-shrink: 0; }
  .receipt-header-compact .receipt-header-text { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .receipt-header-compact .receipt-title { margin-top: 0; }
  .receipt-header-compact .receipt-subtitle,
  .receipt-header-compact .receipt-subtitle-name { margin-top: 6px; }
  .receipt-section { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #999; }
  .receipt-section:first-of-type { border-top: none; }
  .receipt-section-title {
    font-size: 15px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #444;
    margin-bottom: 5px;
  }
  .receipt-line { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; }
  .receipt-line .label { color: #222; }
  .receipt-line .value { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .receipt-line.bold { font-weight: 700; }
  .receipt-line.large { font-size: 22px; font-weight: 700; }
  .receipt-total {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid #111;
    font-size: 24px;
    font-weight: 800;
  }
  .receipt-footer {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px dashed #999;
    text-align: center;
    font-size: 17px;
    color: #333;
  }
  .receipt-footer p { margin: 0 0 6px; }
  .receipt-footer p:last-child { margin-bottom: 0; }
  .receipt-footer ul, .receipt-footer ol { margin: 0 0 6px; padding-left: 18px; text-align: left; }
  .receipt-footer blockquote { margin: 0 0 6px; padding-left: 8px; border-left: 2px solid #ccc; }
  /* Уровни заголовков в футере — реально разного размера (найдено
     пользователем 2026-07-20). */
  .receipt-footer .rt-h1 { font-size: 22px; font-weight: 800; color: #111; margin: 0 0 8px; }
  .receipt-footer .rt-h2 { font-size: 19px; font-weight: 700; color: #111; margin: 0 0 7px; }
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

// Печатный рендер PMNode -> HTML-строка — то же дерево узлов/меток, что
// src/components/landing/rich-text.tsx (RichText, публичная страница
// Лендинга) и src/lib/instructions/pdf.ts (PDF-вариант), но третий вывод:
// сюда, в самодостаточный HTML печатной разметки. Не переиспользует
// RichText напрямую — тот React-компонент, а печатная разметка собирается
// как HTML-строка (innerHTML), без React-рендера.
function renderMarksHtml(text: string, marks: { type: string }[] | undefined): string {
  let html = escapeHtml(text);
  for (const mark of marks ?? []) {
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "underline") html = `<u>${html}</u>`;
  }
  return html;
}

function renderPMChildren(nodes: PMNode[] | undefined): string {
  return (nodes ?? []).map(renderPMNode).join("");
}

function renderPMNode(node: PMNode): string {
  switch (node.type) {
    case "text":
      return renderMarksHtml(node.text ?? "", node.marks);
    case "hardBreak":
      return "<br />";
    case "paragraph":
      return `<p>${renderPMChildren(node.content)}</p>`;
    case "heading": {
      // Уровни реально различаются размером (найдено пользователем
      // 2026-07-20 по скриншоту: "обычный текст мелкий и размер заголовков
      // не отличается" — раньше все уровни схлопывались в один <p><strong>,
      // визуально неотличимый от обычного жирного абзаца). rt-h1/rt-h2 —
      // тот же принцип суффиксных классов, что у RichText Лендинга
      // (src/components/landing/rich-text.tsx), стили — в RECEIPT_CSS ниже.
      const cls = node.attrs?.level === 1 ? "rt-h1" : "rt-h2";
      return `<p class="${cls}">${renderPMChildren(node.content)}</p>`;
    }
    case "bulletList":
      return `<ul>${renderPMChildren(node.content)}</ul>`;
    case "orderedList":
      return `<ol>${renderPMChildren(node.content)}</ol>`;
    case "listItem":
      return `<li>${renderPMChildren(node.content)}</li>`;
    case "blockquote":
      return `<blockquote>${renderPMChildren(node.content)}</blockquote>`;
    case "horizontalRule":
      return "<hr />";
    default:
      return "";
  }
}

export function pmNodeToHtml(doc: PMNode): string {
  return renderPMChildren(doc.content);
}

function renderSection(section: PrintSection): string {
  const title = section.title ? `<div class="receipt-section-title">${escapeHtml(section.title)}</div>` : "";
  const lines = section.lines
    .map((l) => {
      const cls = [l.bold && "bold", l.large && "large"].filter(Boolean).join(" ");
      return `<div class="receipt-line${cls ? ` ${cls}` : ""}"><span class="label">${escapeHtml(l.label)}</span><span class="value">${escapeHtml(l.value)}</span></div>`;
    })
    .join("");
  return `<div class="receipt-section">${title}${lines}</div>`;
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
  // isRichContentEmpty, не pmNodeToHtml(...).trim() — реальный баг, найден
  // при самопроверке 2026-07-20: пустой параграф без текста (стандартное
  // состояние редактора после того, как весь текст стёрли, ProseMirror
  // всегда оставляет хотя бы один пустой блок) рендерится в "<p></p>" —
  // непустую строку после .trim(), из-за чего футер показывал пустую
  // секцию с разделительной линией даже когда владелец ничего не написал.
  const footer =
    branding.footerContent && !isRichContentEmpty(branding.footerContent)
      ? `<div class="receipt-footer">${pmNodeToHtml(branding.footerContent)}</div>`
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

  return `
    <div class="receipt-paper">
      <div class="receipt">
        ${header}
        ${sections}
        ${total}
        ${footer}
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
  document.title = data.title;
  window.addEventListener("afterprint", restoreTitle, { once: true });
  setTimeout(restoreTitle, 5000);

  window.print();
}
