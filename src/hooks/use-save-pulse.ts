"use client";

import { useCallback, useRef, useState } from "react";

// Единая логика "галочка сохранения" для SaveButton по всему проекту (запрос
// пользователя 2026-07-16: "не всегда вижу, особенно на Bottom Sheet") —
// раньше каждая страница сама заводила флаг saved + setTimeout, и в
// подавляющем большинстве мест (~40 использований SaveButton) это просто
// забыли сделать, поэтому галочка нигде не появлялась. Плюс там, где после
// сохранения что-то закрывается (bottom sheet, режим редактирования) —
// закрытие раньше происходило СРАЗУ, до того как галочка успевала
// прорисоваться и хоть на мгновение стать заметной. pulse() показывает
// галочку, держит её holdMs (достаточно, чтобы пользователь "почувствовал",
// что сохранение произошло), и только потом вызывает переданный колбэк
// закрытия/сброса — вместо немедленного вызова.
export function useSavePulse(holdMs = 550) {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pulse = useCallback(
    (after?: () => void) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setSaved(true);
      timerRef.current = setTimeout(() => {
        setSaved(false);
        after?.();
      }, holdMs);
    },
    [holdMs]
  );

  return { saved, pulse };
}
