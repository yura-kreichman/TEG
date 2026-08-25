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

// Сохранённое значение может «протухнуть»: точку удалили, либо в этом же
// браузере открыли кабинет ДРУГОГО владельца (localStorage общий на домен —
// и обычный вход под вторым аккаунтом, и имперсонация из админки попадают в
// один и тот же ключ). Тогда экран запрашивает чужую точку, API отвечает 404
// «Точка не найдена», и владелец видит пустой экран без единого способа это
// починить: селектор точек рендерится только при points.length > 1, а у
// тенанта с одной точкой его нет вовсе (реальный баг, найден пользователем
// 2026-08-25 на "Итогах по дням" тенанта «Игроленд» при заходе админом).
// fallback — чем заменить протухшее значение: "first" у экранов, где точка
// обязательна (Итоги по дням, Остатки, Товары), "all" там, где null означает
// «Все точки» (Главная, Деньги).
export function reconcilePointId<T extends { id: string }>(
  prev: string | null,
  list: T[],
  fallback: "first" | "all"
): string | null {
  if (prev && list.some((p) => p.id === prev)) return prev;
  return fallback === "first" ? (list[0]?.id ?? null) : null;
}

export function usePersistedPointId(
  urlOverride?: string | null
): [string | null, (update: PointIdUpdater) => void] {
  const [pointId, setPointIdState] = useState<string | null>(urlOverride ?? null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (urlOverride) {
      localStorage.setItem(STORAGE_KEY, urlOverride);
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setPointIdState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlOverride]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
