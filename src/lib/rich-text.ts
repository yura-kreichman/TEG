// Общий формат структурированного текста — ProseMirror/Tiptap JSON, не HTML.
// Изначально появился для модуля Инструктажи (src/lib/instructions/content.ts,
// там же обоснование выбора формата), сюда вынесена доменно-нейтральная часть
// (типы + белый список + валидация + извлечение текста), чтобы модуль
// Лендинг мог использовать тот же примитивный редактор (решение пользователя
// 2026-07-13: "тот же примитвный редактор, как и в инструкциях" — для
// описания зон и текста "О нас") без завязки на пакет Инструктажей.
export const ALLOWED_CHILD_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "hardBreak",
  "blockquote",
  "horizontalRule",
]);

export const ALLOWED_MARK_TYPES = new Set(["bold", "italic", "underline"]);

const ALLOWED_HEADING_LEVELS = new Set([1, 2]);

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string }[];
}

// Пустой документ-заглушка для полей, у которых ещё нет сохранённого
// содержимого (владелец ничего не заполнил) — передаётся в InstructionEditor
// как content вместо null/undefined, которых он не принимает.
export const EMPTY_DOC: PMNode = { type: "doc" };

export function validateRichContent(value: unknown): value is PMNode {
  if (!value || typeof value !== "object") return false;
  const node = value as PMNode;
  if (node.type !== "doc") return false;
  // "doc" валиден только как сам корень — проверяем его детей напрямую
  // через validateNode, не сам корневой узел (у него "doc" не входит в
  // ALLOWED_CHILD_NODE_TYPES ровно затем, чтобы вложенный "doc" нигде,
  // кроме этой единственной позиции, не прошёл).
  if (!node.content) return true; // пустой документ — валиден (черновик)
  if (!Array.isArray(node.content)) return false;
  return node.content.every(validateNode);
}

function validateNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as PMNode;

  if (typeof n.type !== "string" || !ALLOWED_CHILD_NODE_TYPES.has(n.type)) return false;

  if (n.type === "heading") {
    const level = n.attrs?.level;
    if (typeof level !== "number" || !ALLOWED_HEADING_LEVELS.has(level)) return false;
  }

  if (n.type === "text") {
    if (typeof n.text !== "string" || n.text.length === 0) return false;
  }

  if (n.marks) {
    if (!Array.isArray(n.marks)) return false;
    for (const mark of n.marks) {
      if (!mark || typeof mark.type !== "string" || !ALLOWED_MARK_TYPES.has(mark.type)) return false;
    }
  }

  if (n.content) {
    if (!Array.isArray(n.content)) return false;
    for (const child of n.content) {
      if (!validateNode(child)) return false;
    }
  }

  return true;
}

// Плоский текст — для лимитов длины при сохранении и (для инструкций) оценки
// времени чтения. Не хранится, считается на лету из content JSON.
export function extractPlainText(node: PMNode): string {
  const parts: string[] = [];

  function walk(n: PMNode) {
    if (n.type === "text" && n.text) parts.push(n.text);
    if (n.content) for (const child of n.content) walk(child);
    if (n.type === "paragraph" || n.type === "heading" || n.type === "listItem") parts.push("\n");
  }

  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// true для "пустого" документа без реального текста — тот же смысл, что
// раньше был у `text === null || text.trim() === ""` для plain-text полей.
export function isRichContentEmpty(node: PMNode | null | undefined): boolean {
  if (!node) return true;
  return extractPlainText(node).length === 0;
}

// Оборачивает обычную строку (перенос строки — \n) в валидный doc: один
// paragraph, строки внутри него разделены hardBreak (ProseMirror не
// допускает буквальный \n внутри text-узла). Нужно там, где раньше
// показывался шаблонный plain-text (i18n-заглушка "О нас" по умолчанию —
// src/lib/landing/get-render-data.ts), а рендерит теперь тот же
// rich-text-компонент, что и реальный контент владельца.
export function plainTextToDoc(text: string): PMNode {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const content: PMNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    content.push({ type: "text", text: line });
  });
  return { type: "doc", content: [{ type: "paragraph", content }] };
}
