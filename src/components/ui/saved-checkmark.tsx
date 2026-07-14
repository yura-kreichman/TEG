import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Обратная связь "сохранено" вне кнопки (автосохранение по onChange, без
// отдельного клика) — не текст t.common.saved, а галочка, которая быстро
// всплывает с эффектом zoom и так же зумом пропадает (решение пользователя
// 2026-07-14). Рендерится всегда (не условно) — scale-0 в состоянии
// "скрыто", иначе анимации не откуда стартовать.
export function SavedCheckmark({ show, className }: { show: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "mx-auto flex size-7 items-center justify-center rounded-full bg-success/15 text-success transition-transform duration-200 ease-out",
        show ? "scale-100" : "scale-0",
        className
      )}
    >
      <Check className="size-4" />
    </div>
  );
}
