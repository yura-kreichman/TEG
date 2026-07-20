import { cn } from "@/lib/utils";

/**
 * Базовый блок-заглушка для скелетонов (запрос пользователя 2026-07-20) —
 * bg-muted + animate-pulse, те же токены, что и остальной проект (никаких
 * hex вне семантических токенов). Форма/размер задаются снаружи через
 * className (rounded-control/rounded-card и т.п. — свои у каждого места
 * использования), это только цвет+анимация.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-control bg-muted", className)} />;
}

/**
 * Строка списка "круглая иконка/аватар + заголовок + подпись" — самый
 * частый тип карточки по проекту (Сотрудники/Точки/Абонементы и т.п.),
 * повторяется буквально в SpringCard-списках. count — сколько таких строк
 * показать (по умолчанию 3, ощущается как "список", не как одна карточка).
 */
export function SkeletonListRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-card border border-border bg-card p-4.5 shadow-card-rest">
          <Skeleton className="size-12.5 shrink-0 rounded-full" />
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </>
  );
}
