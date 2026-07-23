// Контент инструкции — ProseMirror/Tiptap JSON, не HTML (docs/spec/07-
// instructions.md, Шаг 2: обоснование). Защита от XSS — белый список
// node/mark типов, СТРУКТУРНАЯ, не санитайзер поверх свободного HTML: если
// тип узла не входит в набор, документ целиком отклоняется при сохранении
// (см. владельческий PATCH-роут). "doc" НЕ входит в белый список специально
// — валиден только как корень целиком (см. validateRichContent в
// src/lib/rich-text.ts), не как узел где-то внутри дерева. Без этого
// разделения вложенный { type: "doc", content: [...] } внутри чужого content
// проходил валидацию (структурно "тип из списка"), но ронял и генератор PDF,
// и рендер на публичной странице ("node.type.spec.toDOM is not a function") —
// найдено на Шаге 6 через собственный тестовый скрипт, который по ошибке
// собрал такую вложенность; тот же вектор доступен и настоящему злоумышленнику
// через прямой запрос к PATCH-роуту в обход редактора.
//
// Сам белый список + валидация + PMNode — доменно-нейтральны, вынесены в
// src/lib/rich-text.ts, т.к. с 2026-07-13 тот же примитивный редактор
// использует и модуль Лендинг (описание зон, "О нас") — этот файл теперь
// тонкая обёртка с именами под модуль Инструктажей, чтобы не трогать
// остальные файлы, которые их импортируют.
import { ALLOWED_CHILD_NODE_TYPES, ALLOWED_MARK_TYPES, extractPlainText, validateRichContent, type PMNode } from "@/lib/rich-text";

export { ALLOWED_CHILD_NODE_TYPES, ALLOWED_MARK_TYPES, extractPlainText, type PMNode };

export function validateInstructionContent(value: unknown): value is PMNode {
  return validateRichContent(value);
}

// Верхняя граница объёма — та же защита, что уже есть у Лендинга (aboutText
// ≤ 4000, src/app/api/tenant/landing/route.ts), но шире: реальная инструкция
// (техника безопасности, договор) законно может быть в разы длиннее
// маркетингового "О нас". У Инструктажей такого предела не было вообще
// (аудит 2026-07-24) — неограниченный текст долетал до PDF-генератора
// (pdfkit, без верхней границы страниц) и до публичной страницы/уведомлений
// без единой проверки.
export const MAX_INSTRUCTION_CONTENT_LENGTH = 50000;

const WORDS_PER_MINUTE = 150; // средняя скорость чтения делового текста на русском

export function estimateReadingMinutes(node: PMNode): number {
  const text = extractPlainText(node);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}
