"use client";

import { useRef, useState } from "react";

/**
 * Самогаснущее сообщение поверх экрана (запрос пользователя 2026-07-22:
 * "должно быть сообщение по типу, как у Сотрудника если не найден заказ" —
 * тот же приём, что flashSearchError в operator/tickets/page.tsx, вынесен в
 * переиспользуемый хук для активации/деактивации Точки/Зоны/Актива).
 * Вариант цвета — по результату действия (запрос пользователя того же дня:
 * "Активна зелёная, 'Не активна' красная"), не всегда success.
 */
export function useActionToast(durationMs = 2000) {
  const [state, setState] = useState<{ message: string; variant: "success" | "error" } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flash(message: string, variant: "success" | "error" = "success") {
    setState({ message, variant });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState(null), durationMs);
  }

  return { message: state?.message ?? null, variant: state?.variant ?? "success", flash };
}
