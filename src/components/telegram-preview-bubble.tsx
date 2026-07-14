// Реплика тёмного чата Telegram (docs/design/prototype-telegram-summaries-v1.html,
// .tg-preview/.tg-bubble) — фиксированные hex-цвета намеренные: это чат
// Telegram, а не хром RentOS, он выглядит одинаково независимо от темы
// кабинета владельца (светлой/тёмной), поэтому не берётся из токенов темы.
// Текст — реальный HTML, который формирует telegram-format.ts (тег <b> —
// Telegram parse_mode=HTML), контент полностью наш (не пользовательский ввод).
export function TelegramPreviewBubble({ text, time }: { text: string; time: string }) {
  return (
    <div className="rounded-card p-3.5" style={{ background: "#17212B" }}>
      <div className="max-w-full rounded-tr-[14px] rounded-tl-[14px] rounded-br-[14px] rounded-bl-[4px] px-3 py-2.5" style={{ background: "#232E3C" }}>
        <div className="mb-1 text-xs font-bold" style={{ color: "#6AB2F2" }}>
          RentOS Бот
        </div>
        <div
          className="text-[0.78125rem] leading-relaxed whitespace-pre-wrap tabular-nums [&_blockquote]:my-1 [&_blockquote]:rounded-[4px] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#6AB2F2] [&_blockquote]:bg-white/4 [&_blockquote]:py-0.5 [&_blockquote]:pl-2 [&_blockquote]:whitespace-pre-wrap [&_code]:font-mono [&_code]:text-[0.75rem]"
          style={{ color: "#E9EEF4" }}
          dangerouslySetInnerHTML={{ __html: text }}
        />
        <div className="mt-1 text-right text-[0.65625rem]" style={{ color: "#6C7883" }}>
          {time}
        </div>
      </div>
    </div>
  );
}
