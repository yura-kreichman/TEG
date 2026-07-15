"use client";

import { formatMoney } from "@/lib/format";
import { getCurrencySign } from "@/lib/currency";
import { useCurrency, useLocale } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

// Единственная точка входа для денежных сумм в кабинете и PWA
// (docs/spec/03-design-system.md, "Числа и деньги" → "Реализация") —
// formatMoney() + опциональный знак валюты тенанта. Прямые вставки знаков
// валют в разметку/i18n запрещены спекой — только этот компонент.
//
// Знак показывается всегда (запрос пользователя 2026-07-15: пробовали
// прятать его в мелком тексте — без знака сумма читалась двусмысленно в
// любом контексте). 0.85em — "на 15% меньше текста" (дословный фидбек) —
// стандартный размер для подавляющего большинства мест.
//
// size="display" — для очень крупных заголовочных чисел ("К выдаче",
// "Прибыль" и т.п., ~1.1875rem и крупнее): при том же 0.85em знак там
// выглядел непропорционально огромным рядом с цифрами (фидбек
// пользователя 2026-07-15 по живым скриншотам) — на этом масштабе знак
// вдвое меньше цифр (0.5em), не 85%.
export function Money({ value, className, size }: { value: number; className?: string; size?: "display" }) {
  const locale = useLocale();
  const currency = useCurrency();
  const sign = getCurrencySign(currency);
  const signSize = size === "display" ? "text-[0.5em]" : "text-[0.85em]";

  return (
    <span className={cn("tabular-nums", className)}>
      {formatMoney(value, locale)}
      {sign && (
        // align-baseline, НЕ translateY и НЕ <sup> — знак должен идти строго
        // в одну строку с суммой, не выше и не ниже (фидбек пользователя
        // 2026-07-15 по живому макету). font-weight фиксированный normal
        // (не наследует жирность числа) — тоже фидбек 2026-07-15.
        <span className={cn("ml-[0.12em] align-baseline font-normal opacity-55", signSize)}>{sign}</span>
      )}
    </span>
  );
}
