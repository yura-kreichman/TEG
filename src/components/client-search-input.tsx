"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ClientSearchInputProps {
  /** Строка запроса как есть: номер целиком, хвост от 4 цифр или имя. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoFocus?: boolean;
  heightClassName?: string;
  sizeClassName?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

/**
 * Поле поиска клиента — одно на телефон и на имя (запрос пользователя
 * 2026-09-01: "искать по последним четырём цифрам" + "так же по имени и
 * фамилии"). Что искать, решает содержимое строки, а не режим экрана: есть
 * буква — ищем по имени, только цифры — по номеру (см. classifyClientQuery в
 * lib/client-query.ts).
 *
 * Отдельный компонент от PhoneInput, а не флаг на нём: PhoneInput вычищает из
 * строки всё, кроме цифр и разделителей номера, и остаётся полем ВВОДА
 * НОМЕРА — им по-прежнему заводят нового клиента, там буквы недопустимы.
 * Здесь наоборот: чистить нельзя, иначе имя не наберёшь.
 *
 * inputMode="text", а не "tel": на цифровой клавиатуре планшета букв нет
 * вовсе, и поиск по имени с неё был бы физически невозможен. Цена — на iOS
 * цифры на один тап дальше ("123"); на экране Клиентов рядом остаётся наш
 * собственный нумпад, он от системной клавиатуры не зависит.
 */
export function ClientSearchInput({
  value,
  onChange,
  id,
  autoFocus,
  heightClassName = "h-12",
  sizeClassName,
  onKeyDown,
}: ClientSearchInputProps) {
  // Автофокус — только там, где есть физическая клавиатура (тот же приём и
  // та же причина, что в PhoneInput): на тач-устройстве он вызвал бы
  // системную клавиатуру поверх уже показанного нумпада.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Input
      ref={inputRef}
      id={id}
      type="text"
      inputMode="text"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={cn(heightClassName, sizeClassName)}
    />
  );
}
