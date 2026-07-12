import PDFDocument from "pdfkit";
import path from "path";
import type { PMNode } from "./content";

// Статические TTF (SIL OFL, см. fonts/OFL.txt) — тот же шрифт, что и сам
// сайт (Inter, src/app/layout.tsx), не "Onest" из устаревшего упоминания в
// 03-design-system.md (расхождение зафиксировано на Шаге 2). pdfkit не умеет
// сам подставлять начертания вариативного шрифта — нужны отдельные
// статические файлы на каждое сочетание (обычный/жирный/курсив/жирный
// курсив), достаточно для допустимого набора marks редактора.
const FONTS_DIR = path.join(process.cwd(), "src/lib/instructions/fonts");
const FONT_REGULAR = path.join(FONTS_DIR, "Inter-Regular.ttf");
const FONT_BOLD = path.join(FONTS_DIR, "Inter-Bold.ttf");
const FONT_ITALIC = path.join(FONTS_DIR, "Inter-Italic.ttf");
const FONT_BOLD_ITALIC = path.join(FONTS_DIR, "Inter-BoldItalic.ttf");

function fontFor(marks: Set<string>): string {
  const bold = marks.has("bold");
  const italic = marks.has("italic");
  if (bold && italic) return "Inter-BoldItalic";
  if (bold) return "Inter-Bold";
  if (italic) return "Inter-Italic";
  return "Inter";
}

export interface AcknowledgmentPdfInput {
  lastName: string;
  firstName: string;
  birthDate: Date;
  createdAt: Date;
  ip: string;
  signaturePng: Buffer;
  instructionTitle: string;
  versionContent: PMNode;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Один PDF на запись, две смысловые части (docs/spec/07-instructions.md,
// "PDF"): сначала полный текст ИМЕННО ТОЙ версии инструкции, которая была
// подписана (документ самодостаточен, не ссылается на живое состояние
// инструкции в системе), затем "ЗАЯВЛЕНИЕ" с подписью — как настоящая
// подпись к прочитанному документу, а не отдельная справка перед ним
// (решение пользователя 2026-07-12). Явного разрыва страницы перед
// заявлением нет намеренно: если текст инструкции заканчивается не в самом
// низу страницы, подпись естественно продолжает тот же лист, как в бумажном
// документе; на длинных инструкциях pdfkit сам перенесёт её на новую
// страницу, когда не останется места.
export function generateAcknowledgmentPdf(input: AcknowledgmentPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("Inter", FONT_REGULAR);
    doc.registerFont("Inter-Bold", FONT_BOLD);
    doc.registerFont("Inter-Italic", FONT_ITALIC);
    doc.registerFont("Inter-BoldItalic", FONT_BOLD_ITALIC);

    doc.font("Inter-Bold").fontSize(16).text(input.instructionTitle);
    doc.moveDown(0.5);
    for (const block of input.versionContent.content ?? []) {
      renderBlock(doc, block);
    }

    doc.moveDown(1.5);
    // Без заголовка "ЗАЯВЛЕНИЕ" — просто разделительная линия и текст, как
    // подпись в конце договора, а не отдельная официальная справка
    // (решение пользователя 2026-07-12).
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor("#cccccc")
      .stroke();
    doc.moveDown(1);

    const fullName = `${input.lastName} ${input.firstName}`.trim();
    const statement =
      `Я, ${fullName} (дата рождения ${formatDate(input.birthDate)}), прочёл всю инструкцию. ` +
      `Мне всё ясно и понятно. Согласен соблюдать требования и правила, упомянутые в данной инструкции.`;
    doc.font("Inter").fontSize(12).text(statement, { align: "left", lineGap: 4 });
    doc.moveDown(1);

    doc
      .fontSize(10)
      .fillColor("#555555")
      .text(`Дата: ${formatDateTime(input.createdAt)} - IP адрес: ${input.ip}`);
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    doc.font("Inter").fontSize(11).text("Подпись:");
    doc.moveDown(0.3);
    try {
      doc.image(input.signaturePng, { fit: [220, 90] });
    } catch {
      // Не должно происходить (подпись валидируется при подписании), но PDF
      // не должен упасть целиком из-за одного повреждённого изображения.
      doc.fontSize(10).fillColor("#cc0000").text("(изображение подписи повреждено)");
      doc.fillColor("#000000");
    }

    // Футер с подписью на каждой странице, как парафирование каждого листа
    // договора (решение пользователя 2026-07-12) — уменьшенная подпись, не
    // полноразмерная (иначе тяжело смотрится на длинных инструкциях), полная
    // остаётся только в конце. Делается последним проходом по уже готовым
    // страницам (bufferedPageRange), а не по ходу генерации — иначе число
    // страниц ещё не известно.
    for (const i of range(doc.bufferedPageRange())) {
      doc.switchToPage(i);
      drawFooter(doc, fullName, input.signaturePng);
    }

    doc.end();
  });
}

function* range(pageRange: { start: number; count: number }): Generator<number> {
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) yield i;
}

const FOOTER_SIGNATURE_WIDTH = 70;
const FOOTER_SIGNATURE_HEIGHT = 26;

function drawFooter(doc: PDFKit.PDFDocument, fullName: string, signaturePng: Buffer): void {
  const { left, right, bottom } = doc.page.margins;
  const pageWidth = doc.page.width;
  const lineY = doc.page.height - 46;
  const contentY = lineY + 8;

  // Футер рисуется НИЖЕ обычного нижнего поля страницы — pdfkit иначе решает,
  // что места не осталось, и молча вставляет лишнюю пустую страницу перед
  // текстом (сравнивает целевой y с page.maxY() = height − margins.bottom).
  // На время рисования футера снимаем нижнее поле, потом возвращаем как было.
  doc.page.margins.bottom = 0;
  doc.save();
  doc.moveTo(left, lineY).lineTo(pageWidth - right, lineY).strokeColor("#dddddd").stroke();

  try {
    doc.image(signaturePng, left, contentY, { fit: [FOOTER_SIGNATURE_WIDTH, FOOTER_SIGNATURE_HEIGHT] });
  } catch {
    // Футер не критичен (полная подпись всё равно есть в конце документа) —
    // молча пропускаем изображение, не портим страницу сообщением об ошибке.
  }

  doc
    .font("Inter")
    .fontSize(8)
    .fillColor("#888888")
    .text(fullName, left + FOOTER_SIGNATURE_WIDTH + 10, contentY + FOOTER_SIGNATURE_HEIGHT / 2 - 5, {
      width: pageWidth - left - right - FOOTER_SIGNATURE_WIDTH - 10,
      lineBreak: false,
    });

  doc.restore();
  doc.page.margins.bottom = bottom;
}

function renderBlock(doc: PDFKit.PDFDocument, node: PMNode, listPrefix?: string, quoteIndent?: number): void {
  switch (node.type) {
    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      renderInline(doc, node, level === 1 ? 15 : 13, true, undefined, quoteIndent);
      doc.moveDown(0.4);
      return;
    }
    case "paragraph": {
      if (!node.content || node.content.length === 0) {
        doc.moveDown(0.5);
        return;
      }
      renderInline(doc, node, 11, false, listPrefix, quoteIndent);
      doc.moveDown(0.5);
      return;
    }
    case "bulletList":
    case "orderedList": {
      const items = node.content ?? [];
      items.forEach((item, i) => {
        const prefix = node.type === "bulletList" ? "•  " : `${i + 1}.  `;
        for (const child of item.content ?? []) {
          renderBlock(doc, child, prefix, quoteIndent);
        }
      });
      doc.moveDown(0.2);
      return;
    }
    case "blockquote": {
      // Левая полоска, как .prose-instruction blockquote в CSS — рисуется
      // ПОСЛЕ текста, т.к. до рендера неизвестна итоговая высота блока.
      // Отступ (quoteIndent) сдвигает сам текст вправо от полоски, иначе
      // линия рисуется вплотную к буквам.
      const startY = doc.y;
      const startX = doc.page.margins.left;
      doc.fillColor("#555555");
      for (const child of node.content ?? []) {
        renderBlock(doc, child, undefined, 14);
      }
      doc.fillColor("#000000");
      doc
        .moveTo(startX, startY)
        .lineTo(startX, doc.y)
        .strokeColor("#cccccc")
        .lineWidth(2)
        .stroke();
      doc.lineWidth(1);
      return;
    }
    case "horizontalRule": {
      doc.moveDown(0.3);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor("#cccccc")
        .stroke();
      doc.moveDown(0.5);
      return;
    }
    default:
      return;
  }
}

// pdfkit не умеет смешивать начертания в одном .text() — эмулируем через
// цепочку вызовов с { continued: true }, переключая шрифт перед каждым
// сегментом текста, объединённым одним набором marks.
function renderInline(
  doc: PDFKit.PDFDocument,
  node: PMNode,
  fontSize: number,
  forceBold: boolean,
  prefix?: string,
  indent?: number
): void {
  const segments = node.content ?? [];
  doc.fontSize(fontSize);

  if (prefix) {
    doc.font("Inter").text(prefix, { continued: true, indent: indent ?? 12 });
  }

  if (segments.length === 0) {
    doc.font("Inter").text("", prefix ? undefined : { indent });
    return;
  }

  segments.forEach((seg, i) => {
    const marks = new Set((seg.marks ?? []).map((m) => m.type));
    if (forceBold) marks.add("bold");
    const underline = marks.has("underline");
    doc.font(fontFor(marks)).text(seg.text ?? "", {
      continued: i < segments.length - 1,
      underline,
      ...(i === 0 && !prefix ? { indent } : {}),
    });
  });
}
