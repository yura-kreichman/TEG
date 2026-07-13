"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Minus, Quote, Underline as UnderlineIcon } from "lucide-react";
import { PressableScale } from "@/components/motion/pressable-scale";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import type { PMNode } from "@/lib/instructions/content";

// Редактор инструкций (docs/spec/07-instructions.md) — набор форматирования
// НАМЕРЕННО ограничен: H1, H2, жирный, курсив, подчёркнутый, списки, цитата,
// разделительная линия. StarterKit по умолчанию включает ещё code/codeBlock/
// strike/link (И underline — в Tiptap v3, в отличие от v2, он уже встроен в
// StarterKit, отдельный @tiptap/extension-underline не нужен и даёт варнинг
// "Duplicate extension names" при совместной регистрации, найдено визуальной
// проверкой Шага 4) — всё лишнее явно выключено ниже, иначе редактор мог бы
// произвести JSON, который сервер (src/lib/instructions/content.ts, тот же
// белый список) молча отклонит при сохранении — лучше не давать создать такой
// контент вовсе, чем ловить ошибку постфактум. blockquote/horizontalRule
// добавлены решением пользователя 2026-07-12 — оба уже есть в StarterKit
// "бесплатно", ни одной новой npm-зависимости.
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    code: false,
    codeBlock: false,
    strike: false,
    link: false,
  }),
];

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <PressableScale>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-9 items-center justify-center rounded-control text-sm font-semibold transition-colors",
          active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
        )}
      >
        {children}
      </button>
    </PressableScale>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border p-1.5">
      <ToolbarButton
        label="Заголовок 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        label="Заголовок 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label="Жирный" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Курсив" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Подчёркнутый"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label="Маркированный список"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Нумерованный список"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label="Цитата"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Разделительная линия" active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </ToolbarButton>
    </div>
  );
}

export function InstructionEditor({
  content,
  onChange,
  onBlur,
  editable = true,
  heightClassName = "h-[60vh] min-h-80",
}: {
  content: PMNode;
  onChange?: (content: PMNode) => void;
  // Типтап-редактор обновляет onChange на каждое нажатие клавиши — для полей
  // с батч-сохранением по кнопке (аналог onChange у textarea) этого
  // достаточно, но список, который сохраняет каждую запись по отдельности
  // (подписи зон Лендинга — было onBlur у textarea), нужен явный колбэк
  // потери фокуса с актуальным контентом на момент блюра.
  onBlur?: (content: PMNode) => void;
  editable?: boolean;
  // Инструкция — единственный контент на странице, фиксированная большая
  // высота уместна. Переиспользование в Лендинге (описание зон, "О нас")
  // — одно поле среди многих в форме настроек, где такая высота
  // доминировала бы над страницей — вызывающий код может её переопределить.
  heightClassName?: string;
}) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: content as object,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON() as PMNode);
    },
    onBlur: ({ editor }) => {
      onBlur?.(editor.getJSON() as PMNode);
    },
    editorProps: {
      attributes: {
        // Публичная страница (docs/spec/07-instructions.md, "Макеты и
        // вёрстка"): "Никаких карточек и декора — это документ, не лендинг" —
        // отступы только у редактируемой версии владельца, где они визуально
        // сообщают "это поле ввода внутри карточки". Высота теперь у
        // ВНЕШНЕГО контейнера ниже (фиксированная, со своим скроллом), не у
        // этого элемента — раньше росла вместе с текстом, и на длинной
        // инструкции тулбар уезжал вверх страницы (пользователь: "приходится
        // скроллить вверх, чтобы выделенный фрагмент сделать жирным").
        class: cn("prose-instruction focus:outline-none text-body-airbnb", editable && "px-4 py-3"),
      },
    },
  });

  // Внешняя правка content (например, при первой загрузке черновика с сервера
  // после того, как editor уже создан) — синхронизируем без потери позиции
  // курсора, если контент реально отличается.
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(content);
    if (current !== next) editor.commands.setContent(content as object, { emitUpdate: false });
  }, [editor, content]);

  if (!editor) return null;

  if (!editable) {
    return <EditorContent editor={editor} />;
  }

  return (
    // Фиксированная высота + внутренний скролл (не растёт вместе с текстом) —
    // тулбар всегда виден и достижим без прокрутки страницы, независимо от
    // длины инструкции.
    <div className={cn("flex flex-col overflow-hidden rounded-card border border-border bg-card", heightClassName)}>
      <Toolbar editor={editor} />
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
