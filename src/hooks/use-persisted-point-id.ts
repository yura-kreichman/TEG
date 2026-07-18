"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "rentos-selected-point-id";

// Владелец выбирает точку в дропдауне на Главной/Деньгах/Итогах по дням —
// без сохранения выбор сбрасывался на "Все точки"/первую точку при каждом
// заходе (запрос пользователя 2026-07-19: "чтобы каждый раз не переключалось
// на первую точку"). localStorage, не cookie — это чисто клиентское
// UI-предпочтение, на сервер не влияет.
//
// urlOverride — точка, явно переданная через ?pointId= при переходе с другого
// экрана (запрос пользователя 2026-07-16, "выбор точки наследуется при
// переходе") — она приоритетнее сохранённого значения и сама обновляет
// сохранённое значение, чтобы прямой переход "Домой → Деньги" тоже запоминал
// точку для следующего захода без параметра.
type PointIdUpdater = string | null | ((prev: string | null) => string | null);

export function usePersistedPointId(
  urlOverride?: string | null
): [string | null, (update: PointIdUpdater) => void] {
  const [pointId, setPointIdState] = useState<string | null>(urlOverride ?? null);

  useEffect(() => {
    if (urlOverride) {
      localStorage.setItem(STORAGE_KEY, urlOverride);
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setPointIdState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlOverride]);

  // Тот же функциональный апдейтер, что и у нативного useState (readings/page.tsx
  // использует `setPointId(prev => prev ?? list[0]?.id ?? null)` — не сужать сигнатуру.
  function setPointId(update: PointIdUpdater) {
    setPointIdState((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
      return next;
    });
  }

  return [pointId, setPointId];
}
