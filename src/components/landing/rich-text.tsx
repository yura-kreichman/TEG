import type { PMNode } from "@/lib/rich-text";

// Серверный рендер PMNode -> JSX для публичной страницы Лендинга. Отдельно
// от InstructionEditor (src/components/instructions/instruction-editor.tsx,
// "use client" на @tiptap/react) намеренно: /site/[slug] — не React Client
// Component маршрут (docs/spec/08-landing.md, "Правила вёрстки" — один
// клиентский компонент тянет ~230КБ react-dom-хайдратации на весь маршрут,
// бюджет ~200KB gzip в CLAUDE.md). Визуально идентично: та же CSS-типографика
// .prose-instruction (src/app/globals.css), только разметка получена прямым
// обходом дерева, а не через Tiptap.
function renderMarks(text: string, marks: { type: string }[] | undefined): React.ReactNode {
  let node: React.ReactNode = text;
  for (const mark of marks ?? []) {
    if (mark.type === "bold") node = <strong>{node}</strong>;
    else if (mark.type === "italic") node = <em>{node}</em>;
    else if (mark.type === "underline") node = <u>{node}</u>;
  }
  return node;
}

function renderChildren(nodes: PMNode[] | undefined, keyPrefix: string): React.ReactNode {
  return nodes?.map((node, i) => <RichNode key={`${keyPrefix}-${i}`} node={node} />);
}

function RichNode({ node }: { node: PMNode }) {
  switch (node.type) {
    case "text":
      return renderMarks(node.text ?? "", node.marks);
    case "hardBreak":
      return <br />;
    case "paragraph":
      return <p>{renderChildren(node.content, "p")}</p>;
    case "heading":
      return node.attrs?.level === 1 ? (
        <h1>{renderChildren(node.content, "h1")}</h1>
      ) : (
        <h2>{renderChildren(node.content, "h2")}</h2>
      );
    case "bulletList":
      return <ul>{renderChildren(node.content, "ul")}</ul>;
    case "orderedList":
      return <ol>{renderChildren(node.content, "ol")}</ol>;
    case "listItem":
      return <li>{renderChildren(node.content, "li")}</li>;
    case "blockquote":
      return <blockquote>{renderChildren(node.content, "bq")}</blockquote>;
    case "horizontalRule":
      return <hr />;
    default:
      return null;
  }
}

export function RichText({ doc, className }: { doc: PMNode; className?: string }) {
  return <div className={`lt-prose prose-instruction ${className ?? ""}`.trim()}>{renderChildren(doc.content, "doc")}</div>;
}
