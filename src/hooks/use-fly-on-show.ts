"use client";

import { useEffect, useRef } from "react";

// Общий для SaveButton/SavedCheckmark/DeleteButton "якорь" — при переходе
// show false→true берёт координаты центра своего DOM-узла и шлёт их
// событием eventName ("save-success-fly" слушает SaveSuccessOverlay,
// "delete-success-explode" слушает DeleteSuccessOverlay — оба смонтированы
// один раз в (app)/layout.tsx). Вынесено в хук, чтобы галочка "на кнопке" и
// галочка "при автосохранении по onChange" (без кнопки, например Рабочее
// время) вели себя идентично — решение пользователя 2026-07-16: "интерфейс
// должен быть идентичен" — а позже тот же принцип распространили на удаление
// ("тоже должна быть иконка, как и галочка при сохранении").
export function useFlyOnShow<T extends HTMLElement>(show: boolean, eventName: string) {
  const anchorRef = useRef<T>(null);
  const wasShown = useRef(false);

  useEffect(() => {
    if (show && !wasShown.current && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        })
      );
    }
    wasShown.current = show;
  }, [show, eventName]);

  return anchorRef;
}
