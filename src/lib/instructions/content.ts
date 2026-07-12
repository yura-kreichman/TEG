// Контент инструкции — ProseMirror/Tiptap JSON, не HTML (docs/spec/07-
// instructions.md, Шаг 2: обоснование). Защита от XSS — белый список
// node/mark типов здесь, СТРУКТУРНАЯ, не санитайзер поверх свободного HTML:
// если тип узла не входит в набор ниже, документ целиком отклоняется при
// сохранении (см. владельческий PATCH-роут).
// "doc" НЕ входит сюда специально — валиден только как корень целиком (см.
// validateInstructionContent), не как узел где-то внутри дерева. Без этого
// разделения вложенный { type: "doc", content: [...] } внутри чужого content
// проходил валидацию (структурно "тип из списка"), но ронял и генератор PDF,
// и рендер на публичной странице ("node.type.spec.toDOM is not a function") —
// найдено на Шаге 6 через собственный тестовый скрипт, который по ошибке
// собрал такую вложенность; тот же вектор доступен и настоящему злоумышленнику
// через прямой запрос к PATCH-роуту в обход редактора.
export const ALLOWED_CHILD_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "hardBreak",
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

export function validateInstructionContent(value: unknown): value is PMNode {
  if (!value || typeof value !== "object") return false;
  const node = value as PMNode;
  if (node.type !== "doc") return false;
  // "doc" валиден только как сам корень — проверяем его детей напрямую
  // через validateNode, не сам корневой узел (у него "doc" не входит в
  // ALLOWED_CHILD_NODE_TYPES ровно затем, чтобы вложенный "doc" нигде,
  // кроме этой единственной позиции, не прошёл).
  if (!node.content) return true; // пустая инструкция — валидна (черновик)
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

// Плоский текст — для оценки времени чтения и (в будущем) полнотекстового
// поиска. Не хранится, считается на лету из content: JSON — единственный
// источник правды, дублировать в отдельное поле незачем.
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

const WORDS_PER_MINUTE = 150; // средняя скорость чтения делового текста на русском

export function estimateReadingMinutes(node: PMNode): number {
  const text = extractPlainText(node);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}
