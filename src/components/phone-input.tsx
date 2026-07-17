"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { dialInfoForTimezone } from "@/lib/locales";
import { cn } from "@/lib/utils";

interface PhoneInputProps {
  // Полный номер (код страны + локальная часть, только цифры/+) — компонент
  // сам показывает в поле лишь локальную часть, префикс отдельным
  // read-only блоком слева.
  value: string;
  onChange: (value: string) => void;
  // /api/tenant/timezone (владелец) или /api/operator/tenant-timezone
  // (оператор) — часовой пояс ТЕНАНТА, единственный сигнал, реально означающий
  // "где физически бизнес" (запрос пользователя 2026-07-17, уточнение того же
  // дня: язык — личная настройка и ничего не говорит о стране, пример "мне
  // удобен русский язык, но я живу в Молдове — это выбрано в часовом поясе";
  // тот же принцип действует везде, не только для этого поля).
  timezoneEndpoint: string;
  id?: string;
  autoFocus?: boolean;
  heightClassName?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  required?: boolean;
}

/**
 * Телефон с read-only префиксом "флаг + код страны" по часовому поясу
 * тенанта (запрос пользователя 2026-07-17: "В read only prefix должен
 * указываться регион+флаг формата номеров телефона") — используется и в
 * модуле "Абонементы" оператора (поиск/создание кошелька), и в кабинете
 * владельца (создание/правка абонемента).
 */
export function PhoneInput({
  value,
  onChange,
  timezoneEndpoint,
  id,
  autoFocus,
  heightClassName = "h-12",
  onKeyDown,
  required,
}: PhoneInputProps) {
  const [timezone, setTimezone] = useState<string>("Europe/Moscow");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch(timezoneEndpoint)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (typeof data?.timezone === "string") setTimezone(data.timezone);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezoneEndpoint]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const { dialCode, flag } = dialInfoForTimezone(timezone);
  // Хранится/сравнивается только цифрами (normalizePhone в src/lib/abonement.ts
  // отбрасывает "+" вместе с остальным форматированием) — сверяем и
  // склеиваем без "+", он только в отображаемом префиксе.
  const dialDigits = dialCode.replace("+", "");
  const localPart = value.startsWith(dialDigits) ? value.slice(dialDigits.length) : value;

  return (
    <div className={cn("flex items-stretch gap-2", heightClassName)}>
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-control border border-input bg-muted px-3 text-body-airbnb font-semibold text-muted-foreground",
          heightClassName
        )}
      >
        <span aria-hidden>{flag}</span>
        <span className="tabular-nums">{dialCode}</span>
      </div>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoFocus={autoFocus}
        value={localPart}
        onChange={(e) => {
          const typed = e.target.value.replace(/[^\d\s()-]/g, "");
          // Ведущий "0" перед местным номером — обычная запись при
          // домашнем наборе (например, Молдова: "0 77795928"), но не часть
          // международного номера после кода страны — если не срезать,
          // тот же человек с тем же номером сохраняется под другим
          // "phone", findWalletByPhone больше не находит существующий
          // кошелёк, и вместо пополнения создаётся дубликат (реальный баг,
          // найден пользователем 2026-07-17: "Юрий"/"Юрочка" — два разных
          // кошелька на один телефон).
          onChange(dialDigits + typed.replace(/^0+/, ""));
        }}
        onKeyDown={onKeyDown}
        required={required}
        className={cn("flex-1", heightClassName)}
      />
    </div>
  );
}
