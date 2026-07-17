"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { useCurrency } from "@/components/i18n-provider";
import { getCurrencySign } from "@/lib/currency";
import { cn } from "@/lib/utils";

// Единая точка входа для полей ввода денежных сумм (запрос пользователя
// 2026-07-15: "по всему проекту, где мы вводим суммы, добавить символ
// валюты" + выравнивание текста вправо "как на калькуляторе") — знак валюты
// тенанта справа в поле, текст вводится тоже справа налево. Обёртка над
// обычным Input, не отдельный компонент с нуля — сохраняет все стили/фокус/
// disabled-состояния базового поля, добавляет только отступ под знак и сам
// знак поверх.
//
// scale="lg" — для крупных полей ввода на весь экран (h-14, text-lg,
// PWA оператора), где стандартный компактный знак (text-sm) выглядел бы
// непропорционально мелким рядом с крупными цифрами. Не "size" — у input
// уже есть нативный HTML-атрибут size (число видимых символов), коллизия.
//
// Знак — квадратная кнопка на лёгком сером фоне с рамкой (тот же стиль, что
// у "−"/"+" степпера Возвратов), не голым текстом поверх поля (фидбек
// пользователя 2026-07-15 по живому скриншоту: голый знак читался как часть
// вводимого числа, будто его тоже можно редактировать; второй раунд —
// "для единообразности стиля, как +, только вместо + значок валюты").
export function MoneyInput({
  className,
  scale,
  ...props
}: React.ComponentProps<typeof Input> & { scale?: "lg" }) {
  const sign = getCurrencySign(useCurrency());

  return (
    // flex-1 min-w-0 тут, не только в className на Input ниже — className
    // приходит на сам <input>, а ширину в строке (flex-row рядом с кнопкой,
    // как "Произвольная сумма" + "Начислить") определяет именно ЭТОТ div:
    // без явного flex-1 он не растягивался, оставался узким, и знак валюты
    // (absolute справа ВНУТРИ него) съезжал за пределы поля — криво висел
    // между полем и кнопкой (нашёл пользователь 2026-07-17). Вне flex-контекста
    // flex-1 ни на что не влияет, так что старым местам использования это
    // ничего не меняет.
    <div className="relative min-w-0 flex-1">
      <Input
        inputMode="decimal"
        {...props}
        className={cn("text-right tabular-nums", scale === "lg" ? "pr-14" : "pr-11", className)}
      />
      {sign && (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center justify-center rounded-control border border-border bg-muted text-muted-foreground",
            scale === "lg" ? "size-10 text-base font-normal" : "size-8 text-sm"
          )}
        >
          {sign}
        </span>
      )}
    </div>
  );
}
