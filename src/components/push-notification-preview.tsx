// Макет типичного OS-уведомления (Android/iOS баннер) — не пиксель-в-пиксель
// повтор конкретной ОС (они отличаются), а обобщённое представление того,
// что реально придёт: маленькая иконка приложения, жирный заголовок, серый
// текст тела, время. Фидбек пользователя 2026-07-12: "добавить... предпросмотр
// внешнего вида уведомлений" — рядом с TelegramPreviewBubble (тот же принцип,
// другой канал).
export function PushNotificationPreview({ title, body, time }: { title: string; body: string; time: string }) {
  return (
    <div className="rounded-card border border-border bg-card p-3 shadow-[0_2px_8px_rgba(0,0,0,.08)]">
      <div className="flex items-start gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-library/pwa/icon-192.png" alt="" className="mt-0.5 size-8 shrink-0 rounded-md object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">RentOS</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span>
          </div>
          <div className="truncate text-[13.5px] font-bold text-foreground">{title}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">{body}</div>
        </div>
      </div>
    </div>
  );
}
