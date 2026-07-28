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
// Вынесено из Money (запрос пользователя 2026-07-28) — когда рядом стоят
// НЕСКОЛЬКО заголовочных чисел (например, Выручка/Прибыль на /reports),
// каждое своим size="display" считает масштаб от СВОЕЙ длины — если суммы
// разной разрядности, числа рендерятся разным font-size и визуально
// "съезжают" относительно друг друга. Вызывающая сторона теперь может
// посчитать один масштаб от самой длинной строки пары и передать его обоим
// через displayScale, чтобы оба числа всегда были одного размера.
//
// Параметры настраиваемые (тот же запрос, для карточки "Бизнес: расходы и
// прибыль") — дефолты калиброваны под крупный заголовок (~2rem, 1-2 широкие
// колонки); узкие колонки (3-4 в ряд, ~1rem шрифт) начинают переполняться
// заметно раньше — там нужен более ранний порог и более резкое уменьшение,
// вызывающая сторона передаёт свои thresholdLength/perCharReduction/minScale.
export function computeMoneyDisplayScale(
  formattedLength: number,
  options?: { thresholdLength?: number; perCharReduction?: number; minScale?: number }
): number {
  const thresholdLength = options?.thresholdLength ?? 6;
  const perCharReduction = options?.perCharReduction ?? 0.08;
  const minScale = options?.minScale ?? 0.55;
  return Math.max(minScale, 1 - Math.max(0, formattedLength - thresholdLength) * perCharReduction);
}

export function Money({
  value,
  className,
  size,
  displayScale: displayScaleOverride,
}: {
  value: number;
  className?: string;
  size?: "display";
  /** Готовый масштаб (см. computeMoneyDisplayScale) — переопределяет
   *  автовычисление по длине ЭТОГО числа, для группы чисел с общим
   *  масштабом. Без size="display" не имеет эффекта. */
  displayScale?: number;
}) {
  const locale = useLocale();
  const currency = useCurrency();
  const sign = getCurrencySign(currency);
  const signSize = size === "display" ? "text-[0.5em]" : "text-[0.85em]";
  const formatted = formatMoney(value, locale);

  // "display" — заголовочные суммы с фиксированным крупным font-size у
  // вызывающей стороны (text-[2rem] и т.п.) — тот размер расcчитан на
  // короткие числа; шестизначная и длиннее сумма при 100% ломает
  // раскладку карточки (реальный баг, найден пользователем 2026-07-19 на
  // /reports: "сейчас 12095 видно нормально, но если там будет 100 000 то
  // уже всё поплывёт"). Масштаб — em относительно font-size родителя (тот
  // остаётся "потолком" для коротких чисел, поэтому короткие суммы визуально
  // не меняются), считается от длины уже отформатированной строки (с
  // пробелами-разделителями разрядов), не только от кол-ва цифр — именно
  // пробелы и добавляют реальную ширину при росте разряда.
  const displayScale =
    size === "display" ? (displayScaleOverride ?? computeMoneyDisplayScale(formatted.length)) : 1;

  return (
    <span
      className={cn("tabular-nums", size === "display" && "transition-[font-size] duration-200", className)}
      // Стиль ставится ВСЕГДА при size="display" (не только когда
      // displayScale !== 1) — запрос пользователя 2026-07-28: "чтобы не
      // перепрыгивало" — сейчас суммы ещё маленькие (масштаб=1, скидки нет),
      // но по мере роста бизнеса он начнёт применяться; без явного
      // fontSize здесь переход от "нет style" к "есть style" не анимируется
      // (transition не видит отсутствующее свойство как отправную точку).
      style={size === "display" ? { fontSize: `${displayScale}em` } : undefined}
    >
      {formatted}
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
