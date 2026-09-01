"use client";

import { Delete, Trash2 } from "lucide-react";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";

interface DigitPadProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Экранный нумпад под полем ввода (запрос пользователя 2026-07-22, тот же
 * приём, что у поиска заказа в Билетах). Жил внутри abonement-topup-flow.tsx,
 * вынесен общим компонентом 2026-09-01, когда поиск клиента стал принимать и
 * имя: поле поиска обязано быть текстовым (на цифровой клавиатуре планшета
 * букв нет вовсе), и без нумпада самый частый путь — набор номера — уехал бы
 * на буквенную клавиатуру. Нумпад возвращает цифры на крупные кнопки, а
 * системная клавиатура нужна только когда действительно набирают имя.
 *
 * Поле рядом остаётся настоящим <input> — с физической клавиатуры печатать
 * можно и без нумпада.
 */
export function DigitPad({ value, onChange }: DigitPadProps) {
  const t = useI18n();
  const keyClass =
    "flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-xl font-bold tabular-nums shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] dark:border-input dark:bg-input/30";
  const utilityClass =
    "flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-muted-foreground shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] disabled:opacity-40 dark:border-input dark:bg-input/30";

  return (
    <div className="grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
        <PressableScale key={k}>
          <button type="button" onClick={() => onChange(value + k)} className={keyClass}>
            {k}
          </button>
        </PressableScale>
      ))}
      <PressableScale>
        <button
          type="button"
          disabled={!value}
          onClick={() => onChange("")}
          aria-label={t.common.delete}
          className={utilityClass}
        >
          <Trash2 className="size-5" />
        </button>
      </PressableScale>
      <PressableScale>
        <button type="button" onClick={() => onChange(value + "0")} className={keyClass}>
          0
        </button>
      </PressableScale>
      <PressableScale>
        <button
          type="button"
          disabled={!value}
          onClick={() => onChange(value.slice(0, -1))}
          aria-label={t.common.back}
          className={utilityClass}
        >
          <Delete className="size-5" />
        </button>
      </PressableScale>
    </div>
  );
}
